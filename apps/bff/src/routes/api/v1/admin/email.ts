import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { emailSettings, isEmailConfigured, renderEmail, sendEmail } from '@pithcharge/notifications';
import { auditAdminAction } from '../../../../services/admin.service';

const adminEmailRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requirePlatformAdmin);

  // GET /admin/email - Non-secret view of the email configuration (set through environment variables)
  fastify.get('/email', {}, async () => emailSettings());

  // POST /admin/email/test - Send a test message to verify delivery
  fastify.post<{ Body: { to?: string } }>(
    '/email/test',
    {
      schema: {
        body: Type.Object({ to: Type.Optional(Type.String({ format: 'email' })) }, { additionalProperties: false }),
      },
    },
    async (request, reply) => {
      if (!isEmailConfigured()) {
        return reply.code(409).send({
          code: 'EMAIL_NOT_CONFIGURED',
          message: 'Email delivery is not configured. Set the SMTP_* or relay environment variables.',
        });
      }
      const to = request.body.to ?? request.user.email;
      const { html, text } = renderEmail({
        heading: 'Email delivery works',
        body: 'This is a test message from your charging platform. If you can read it, outgoing email is configured correctly.',
      });
      try {
        await sendEmail({ to, subject: 'Test email', text, html });
      } catch (error) {
        request.log.warn({ err: error }, 'Test email failed');
        return reply.code(502).send({
          code: 'EMAIL_DELIVERY_FAILED',
          message: error instanceof Error ? error.message : 'The email provider rejected the message.',
        });
      }
      await auditAdminAction({
        actorId: request.user.id,
        action: 'admin.email.test_sent',
        targetType: 'EmailSettings',
        targetId: 'email',
        metadata: { to },
      });
      return { success: true, to };
    },
  );
};

export default adminEmailRoutes;

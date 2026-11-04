import type { PrismaClient } from '@pithcharge/db';
import type { ICmsAdapter, OcppIdTokenType } from '@pithcharge/cms-adapters';
import { syncTokenToCms } from './token-sync.service';

export class TokenService {
  constructor(
    private prisma: PrismaClient,
    private cms: ICmsAdapter,
  ) {}

  /**
   * Link a new card or virtual token to a user and register it on the CMS.
   */
  async linkTokenToUser(params: {
    userId: string;
    idToken: string;
    printedCardNumber?: string;
    nickname?: string;
    tokenType: OcppIdTokenType;
  }) {
    const tokenRecord = await this.prisma.userOcppToken.create({
      data: {
        userId: params.userId,
        idToken: params.idToken,
        printedCardNumber: params.printedCardNumber,
        nickname: params.nickname,
        tokenType: params.tokenType,
        status: 'PENDING_ACTIVATION',
      },
    });

    const synced = await syncTokenToCms(this.cms, {
      idToken: params.idToken,
      tokenType: params.tokenType,
      status: 'ACTIVE',
    });

    return this.prisma.userOcppToken.update({
      where: { id: tokenRecord.id },
      data: { status: synced.status },
    });
  }

  /**
   * Block a lost or stolen token and propagate the change to the CMS.
   */
  async blockToken(userId: string, tokenId: string) {
    const updated = await this.prisma.userOcppToken.update({
      where: { id: tokenId, userId },
      data: { status: 'BLOCKED' },
    });

    await syncTokenToCms(
      this.cms,
      {
        idToken: updated.idToken,
        tokenType: updated.tokenType,
        status: 'BLOCKED',
      },
      { force: true },
    );

    return updated;
  }
}

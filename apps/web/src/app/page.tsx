import { redirect } from 'next/navigation';

// The marketing site lives in its own project (pithcharge-site); the app opens straight to the dashboard.
export default function HomePage() {
  redirect('/dashboard');
}

import { redirect } from 'next/navigation';

/** The application has no marketing surface; the root goes straight to the app. */
export default function RootPage() {
  redirect('/dashboard');
}

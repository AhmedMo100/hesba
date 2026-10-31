import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession } from "@/server/modules/auth";
import { AuthEntryClient } from "./auth-entry-client";

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("hesba_session")?.value;

  if (sessionCookie) {
    try {
      const session = await validateSession(sessionCookie);
      if (session) {
        redirect("/app");
      }
    } catch {
      // Invalid/revoked session cookie, fall through to client login
    }
  }

  return <AuthEntryClient />;
}

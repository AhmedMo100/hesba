import { redirect } from "next/navigation";

/**
 * The e-mail recovery flow was retired: a forgotten password is reset by Hesba's team
 * (docs/ops/password-reset.md). Old links land on the login screen, which says whom to contact.
 */
export default function ForgotPasswordPage() {
  redirect("/login");
}

import { redirect } from "next/navigation";

/** `/` has no page of its own: signed-in users start on the dashboard (the proxy sends others to /login). */
export default function HomePage(): never {
  redirect("/dashboard");
}

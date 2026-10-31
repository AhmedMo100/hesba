import { notFound } from "next/navigation";
import DevAuthClient from "./client";

export default function DevAuthPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevAuthClient />;
}

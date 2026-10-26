import { notFound } from "next/navigation";
import DevUiClient from "./client";

export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevUiClient />;
}

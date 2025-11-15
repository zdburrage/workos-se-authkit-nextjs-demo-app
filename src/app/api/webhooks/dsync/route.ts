import { NextResponse } from "next/server";
import { SignatureVerificationException } from "@workos-inc/node";
import { workos } from "@/app/workos";
import { dsyncEventBus } from "@/app/lib/dsync-event-bus";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const sigHeader = request.headers.get("workos-signature");

    if (!process.env.WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: "WEBHOOK_SECRET is not configured" },
        { status: 500 }
      );
    }

    let event;
    try {
      event = await workos.webhooks.constructEvent({
        payload: rawBody,
        sigHeader: sigHeader as string,
        secret: process.env.WEBHOOK_SECRET,
      });
    } catch (err) {
      if (err instanceof SignatureVerificationException) {
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 400 }
        );
      }
      throw err;
    }

    // Only handle Directory Sync and SCIM related event types for this demo
    const isDSync =
      typeof event?.event === "string" &&
      (event.event.startsWith("dsync.") || event.event.startsWith("scim."));

    const demoEvent = {
      id: event.id ?? `${Date.now()}`,
      type: event.event ?? "unknown",
      createdAt: Date.now(),
      payload: event.data as any,
    };

    if (isDSync) {
      dsyncEventBus.emit(demoEvent);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("DSync webhook error:", error);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";



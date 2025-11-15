import { NextResponse } from "next/server";
import { dsyncEventBus } from "@/app/lib/dsync-event-bus";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = dsyncEventBus.getHistory();
  return NextResponse.json({ events });
}



import { NextResponse } from "next/server";
import { workos } from "@/app/workos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_FILTERS = [
  "dsync.activated",
  "dsync.deleted",
  "dsync.group.created",
  "dsync.group.deleted",
  "dsync.group.updated",
  "dsync.group.user_added",
  "dsync.group.user_removed",
  "dsync.user.created",
  "dsync.user.deleted",
  "dsync.user.updated"
];

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const after = url.searchParams.get("after") || undefined;
    const rangeStart = url.searchParams.get("rangeStart") || undefined;
    const organizationId = url.searchParams.get("organizationId") || undefined;

    const resp = await workos.events.listEvents({
      events: EVENT_FILTERS as any,
      after,
      rangeStart: after ? undefined : rangeStart,
      organizationId: organizationId || undefined,
      limit: 50,
    });

    return NextResponse.json({
      events: resp.data.map((evt: any) => ({
        id: evt.id,
        type: evt.event,
        createdAt: new Date(evt.created_at ?? Date.now()).getTime(),
        payload: evt.data,
      })),
      nextAfter: resp.data.length > 0 ? resp.data[resp.data.length - 1].id : after || null,
    });
  } catch (err) {
    console.error("Poll error", err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}



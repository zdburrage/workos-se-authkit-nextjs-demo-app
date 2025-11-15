"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Card, Code, Flex, Heading, ScrollArea, Select, Text, Badge, Separator } from "@radix-ui/themes";

type EventItem = {
  id: string;
  type: string;
  createdAt: number;
  payload: any;
};

type DisplayEvent = EventItem & {
  action: "created" | "updated" | "deleted" | "activated" | "deactivated" | "user_added" | "user_removed" | "other";
  entityType: "user" | "group" | "directory" | "organization" | "connection" | "other";
  entityId?: string;
  headline: string;
  subline?: string;
  changes?: Array<{ field: string; before: any; after: any }>;
};

export default function DSyncEventsPage() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const initialRangeStartRef = useRef<string | null>(null);
  const lastEntityRef = useRef<Record<string, any>>({});

  const visibleEvents = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.type.startsWith(filter));
  }, [events, filter]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleEvents, autoScroll]);

  useEffect(() => {
    let after: string | null = null;
    let cancelled = false;

    const buildUrl = () => {
      const url = new URL(window.location.origin + "/api/dsync-events/poll");
      const params = new URLSearchParams(window.location.search);
      // Default rangeStart to when the page opened if not provided
      const rangeStart = params.get("rangeStart") || initialRangeStartRef.current || undefined;
      const organizationId = params.get("organizationId");
      if (after) url.searchParams.set("after", after);
      if (!after && rangeStart) url.searchParams.set("rangeStart", rangeStart);
      if (organizationId) url.searchParams.set("organizationId", organizationId);
      return url.toString();
    };

    const poll = async () => {
      try {
        const res = await fetch(buildUrl());
        if (!res.ok) throw new Error("poll error");
        const data = await res.json();
        if (cancelled) return;
        setConnected(true);
        if (Array.isArray(data.events) && data.events.length > 0) {
          const transformed: EventItem[] = data.events.map((e: EventItem) => e);
          setEvents((prev) => [...prev, ...transformed]);
        }
        after = data.nextAfter || after;
      } catch (e) {
        if (cancelled) return;
        setConnected(false);
      } finally {
        if (!cancelled) setTimeout(poll, 5000);
      }
    };

    // Capture the initial timestamp once at mount
    if (!initialRangeStartRef.current) {
      initialRangeStartRef.current = new Date().toISOString();
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  const uniquePrefixes = useMemo(() => {
    const prefixes = new Set<string>(["all"]);
    for (const e of events) {
      const prefix = e.type.split(".")[0];
      prefixes.add(prefix);
    }
    return Array.from(prefixes);
  }, [events]);

  const toDisplayEvent = (e: EventItem): DisplayEvent => {
    const parts = e.type.split(".");
    const ns = parts[0] || "other";
    const verb = parts.slice(1).join("_") || "other";

    const entityType: DisplayEvent["entityType"] = ns === "dsync"
      ? (parts[1] === "user" ? "user" : parts[1] === "group" ? "group" : "directory")
      : ns === "scim"
      ? (parts[1] === "user" ? "user" : parts[1] === "group" ? "group" : "other")
      : "other";

    const action: DisplayEvent["action"] =
      e.type.endsWith("created") ? "created" :
      e.type.endsWith("updated") ? "updated" :
      e.type.endsWith("deleted") ? "deleted" :
      e.type.endsWith("user_added") ? "user_added" :
      e.type.endsWith("user_removed") ? "user_removed" :
      e.type.endsWith("activated") ? "activated" :
      e.type.endsWith("deactivated") ? "deactivated" : "other";

    const payload: any = e.payload || {};
    const entityId: string | undefined = payload?.id;
    const key = entityType + ":" + (entityId || e.id);
    const prev = lastEntityRef.current[key];

    const pickUser = (p: any) => ({
      id: p?.id,
      email: p?.email,
      first_name: p?.first_name,
      last_name: p?.last_name,
      state: p?.state,
      directory_id: p?.directory_id,
    });
    const pickGroup = (p: any) => ({ id: p?.id, name: p?.name, directory_id: p?.directory_id });
    const pickDirectory = (p: any) => ({ id: p?.id, name: p?.name, organization_id: p?.organization_id });

    const summarize = (): { headline: string; subline?: string } => {
      if (entityType === "user") {
        const u = pickUser(payload);
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || u.id;
        if (action === "created") return { headline: `User created: ${name}`, subline: u.email ? `${u.email}` : undefined };
        if (action === "updated") return { headline: `User updated: ${name}`, subline: u.email ? `${u.email}` : undefined };
        if (action === "deleted") return { headline: `User deleted: ${name}`, subline: u.email ? `${u.email}` : undefined };
        if (action === "user_added") return { headline: `User added to group`, subline: `${name}` };
        if (action === "user_removed") return { headline: `User removed from group`, subline: `${name}` };
        return { headline: `User event`, subline: name };
      }
      if (entityType === "group") {
        const g = payload?.group ? pickGroup(payload.group) : pickGroup(payload);
        const title = g.name || g.id;
        if (action === "created") return { headline: `Group created: ${title}` };
        if (action === "updated") return { headline: `Group updated: ${title}` };
        if (action === "deleted") return { headline: `Group deleted: ${title}` };
        if (action === "user_added") return { headline: `Group member added: ${title}` };
        if (action === "user_removed") return { headline: `Group member removed: ${title}` };
        return { headline: `Group event: ${title}` };
      }
      if (entityType === "directory") {
        const d = pickDirectory(payload);
        const title = d.name || d.id;
        if (action === "activated") return { headline: `Directory activated: ${title}` };
        if (action === "deleted") return { headline: `Directory deleted: ${title}` };
        return { headline: `Directory event: ${title}` };
      }
      return { headline: e.type };
    };

    const diffFields = (before: any, after: any, fields: string[]) => {
      const changes: Array<{ field: string; before: any; after: any }> = [];
      for (const f of fields) {
        if ((before?.[f] ?? undefined) !== (after?.[f] ?? undefined)) {
          changes.push({ field: f, before: before?.[f], after: after?.[f] });
        }
      }
      return changes;
    };

    let changes: DisplayEvent["changes"] = undefined;
    if (action === "updated") {
      if (entityType === "user") {
        const before = prev ? pickUser(prev) : undefined;
        const afterSel = pickUser(payload);
        if (before) changes = diffFields(before, afterSel, ["first_name", "last_name", "email", "state"]);
      } else if (entityType === "group") {
        const before = prev ? pickGroup(prev) : undefined;
        const afterSel = payload?.group ? pickGroup(payload.group) : pickGroup(payload);
        if (before) changes = diffFields(before, afterSel, ["name"]);
      }
    }

    // Update last seen snapshot for future diffs (remove on deletion)
    if (entityId) {
      if (action === "deleted") {
        delete lastEntityRef.current[key];
      } else {
        lastEntityRef.current[key] = payload;
      }
    }

    const { headline, subline } = summarize();
    return { ...e, entityType, action, entityId, headline, subline, changes };
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  const actionBadge = (action: DisplayEvent["action"]) => {
    switch (action) {
      case "created":
        return <Badge color="green" variant="soft">Created</Badge>;
      case "updated":
        return <Badge color="amber" variant="soft">Updated</Badge>;
      case "deleted":
        return <Badge color="red" variant="soft">Deleted</Badge>;
      case "activated":
        return <Badge color="green" variant="soft">Activated</Badge>;
      case "deactivated":
        return <Badge color="gray" variant="soft">Deactivated</Badge>;
      case "user_added":
        return <Badge color="green" variant="soft">User Added</Badge>;
      case "user_removed":
        return <Badge color="red" variant="soft">User Removed</Badge>;
      default:
        return <Badge color="gray" variant="soft">Event</Badge>;
    }
  };

  const entityBadge = (entity: DisplayEvent["entityType"]) => {
    switch (entity) {
      case "user":
        return <Badge color="indigo" variant="soft">User</Badge>;
      case "group":
        return <Badge color="cyan" variant="soft">Group</Badge>;
      case "directory":
        return <Badge color="violet" variant="soft">Directory</Badge>;
      default:
        return <Badge color="gray" variant="soft">Other</Badge>;
    }
  };

  return (
    <Flex direction="column" gap="9" style={{ width: "100%" }}>
      <Flex gap="9" style={{ width: "100%" }}>
        <Heading size="6">Directory Sync Events</Heading>
        <Flex gap="1" align="center">
          <Text size="2" color={connected ? "green" : "red"}>
            {connected ? "Connected" : "Disconnected"}
          </Text>
          <Select.Root value={filter} onValueChange={setFilter}>
            <Select.Trigger placeholder="Filter" />
            <Select.Content>
              {uniquePrefixes.map((p) => (
                <Select.Item key={p} value={p}>
                  {p}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Button variant="soft" onClick={() => setAutoScroll((v) => !v)}>
            {autoScroll ? "Pause Auto-Scroll" : "Resume Auto-Scroll"}
          </Button>
        </Flex>
      </Flex>

      <Card>
        <ScrollArea type="auto" style={{ height: 480 }}>
          <Box p="5">
            {visibleEvents.length === 0 ? (
              <Text color="gray">No events yet. Trigger a DSync or SCIM action.</Text>
            ) : (
              visibleEvents.map((raw, idx) => {
                const e = toDisplayEvent(raw);
                return (
                  <Box key={e.id} mb="3">
                    <Flex align="center" gap="2" wrap="wrap">
                      <Code>{new Date(e.createdAt).toLocaleTimeString()}</Code>
                      {actionBadge(e.action)}
                      {entityBadge(e.entityType)}
                      <Text weight="bold" style={{ lineHeight: 1.2 }}>{e.headline}</Text>
                      {e.subline && (
                        <Text color="gray" style={{ lineHeight: 1.2 }}>{e.subline}</Text>
                      )}
                    </Flex>
                    {e.action === "updated" && e.changes && e.changes.length > 0 && (
                      <Box mt="2" ml="4">
                        <Text size="2" weight="bold">Changes</Text>
                        <Box mt="1">
                          {e.changes.map((c) => (
                            <Flex key={c.field} gap="2" wrap="wrap" align="baseline">
                              <Text size="2" color="gray" style={{ minWidth: 88 }}>{c.field}:</Text>
                              <Text size="2">{String(c.before ?? "")} ➜ {String(c.after ?? "")}</Text>
                            </Flex>
                          ))}
                        </Box>
                      </Box>
                    )}
                    <Box mt="2" ml="4">
                      <Button variant="soft" size="1" onClick={() => toggle(e.id)}>
                        {expanded[e.id] ? "Hide details" : "Show details"}
                      </Button>
                      {expanded[e.id] && (
                        <Box mt="2" p="2" style={{ background: "var(--gray-2)", borderRadius: "var(--radius-2)", maxHeight: 220, overflow: "auto" }}>
                          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </Box>
                      )}
                    </Box>
                    {idx < visibleEvents.length - 1 && (
                      <Box mt="2">
                        <Separator size="4" />
                      </Box>
                    )}
                  </Box>
                );
              })
            )}
            <div ref={bottomRef} />
          </Box>
        </ScrollArea>
      </Card> 
    </Flex>
  );
}



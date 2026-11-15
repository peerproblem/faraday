"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { saveView } from "@/lib/client/views-api";
import { SITE_URL } from "@/lib/config";
import { emptyLayout, type BoardDesign } from "@/lib/spec";

/**
 * On a shared topic's public board. Signed out: goes to sign-in and comes back to the personal dashboard. Already
 * added: opens it. Otherwise saves an empty layout (the baseline as it is, in the shared board's design) and opens the
 * personal dashboard.
 */
export function AddToDashboard({
  boardId,
  slug,
  version,
  signedIn,
  added,
  design,
}: {
  boardId: string;
  slug: string;
  version: number;
  signedIn: boolean;
  added: boolean;
  /** The design the shared board shows, so the personal dashboard opens looking the same. */
  design?: BoardDesign;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const mine = `${SITE_URL}/me/${slug}`;
  if (!signedIn) {
    return (
      <Button href={`${SITE_URL}/login?next=${encodeURIComponent(`/me/${slug}`)}`} variant="outline" size="sm">
        Add to my dashboard
      </Button>
    );
  }
  if (added) {
    return (
      <Button href={mine} variant="outline" size="sm">
        Open my dashboard
      </Button>
    );
  }
  async function add() {
    if (saving) return;
    setSaving(true);
    try {
      await saveView(boardId, { ...emptyLayout(version), ...(design ? { design } : {}) }, 0);
      router.push(mine);
    } catch (e) {
      toast.danger("Could not add it to your dashboards", { description: (e as Error).message });
      setSaving(false);
    }
  }
  return (
    <Button variant="accent" size="sm" loading={saving} onClick={() => void add()}>
      Add to my dashboard
    </Button>
  );
}

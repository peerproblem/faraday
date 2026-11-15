"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { sidebarBounds, WorkspaceResizeHandle, type useWorkspaceSizes } from "./workspace-resize";

export type WorkspaceSidebarContent = {
  title: string;
  content: ReactNode;
  ariaLabel?: string;
  defaultOpen?: boolean;
};

export function WorkspaceSidebar({ id, sidebar, size, mobileOpen, onMobileOpenChange }: {
  id: string;
  sidebar: WorkspaceSidebarContent;
  size: ReturnType<ReturnType<typeof useWorkspaceSizes>>;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const [override, setOpen] = useState<boolean>();
  const open = override ?? sidebar.defaultOpen ?? true;
  const { title } = sidebar;

  return (
    <>
      <div className="fd-workspace-mobile-tools">
        <Button variant="secondary" size="sm" aria-controls={id} aria-expanded={mobileOpen}
          onClick={() => onMobileOpenChange(true)}>{title}</Button>
      </div>
      <aside id={id} className="fd-workspace-sidebar" aria-label={sidebar.ariaLabel ?? title} data-open={open ? "" : undefined}
        style={size.value ? { "--fd-workspace-sidebar-width": `${size.value}px` } as CSSProperties : undefined}>
        <div className="fd-workspace-panel-header">
          <h2 className="min-w-0 truncate text-sm font-semibold" title={title}>{title}</h2>
          <Button className="fd-workspace-desktop-action" size="sm" variant="ghost" iconOnly
            aria-label={`${open ? "Collapse" : "Expand"} ${title}`} aria-expanded={open} aria-controls={`${id}-content`}
            leading={<Icon name={open ? "chevron-left" : "chevron-right"} width={16} height={16} />}
            onClick={() => setOpen(!open)} />
          <Button className="fd-workspace-close" size="sm" variant="ghost" iconOnly aria-label={`Close ${title}`}
            leading={<Icon name="close" width={16} height={16} />} onClick={() => onMobileOpenChange(false)} />
        </div>
        <div id={`${id}-content`} className="fd-workspace-sidebar-content">{sidebar.content}</div>
        {open && <WorkspaceResizeHandle {...size} target={id} label={`Resize ${title} width`} axis="width" getBounds={sidebarBounds} />}
      </aside>
    </>
  );
}

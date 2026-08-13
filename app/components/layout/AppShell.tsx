"use client";

import { useEffect, useRef, useState } from "react";
import { GLOBAL_DESTINATIONS, PROJECT_NAVIGATION, globalNavigationSelection, projectNavigationSelection } from "../../lib/application-navigation.mjs";

type Account = {
  initials: string;
  displayName: string;
  email: string;
  permission: string;
  organization: string;
  signOutUrl: string;
};

export function AppShell(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  globalWorkspace: string;
  globalSection?: string;
  projectWorkspace?: string;
  projectName?: string;
  projectStatus?: string;
  account: Account;
  canViewCommercial: boolean;
  onGlobalNavigate: (workspace: string, section?: string) => void;
  onProjectNavigate: (workspace: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const navigationScrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ Tender: true, Pricing: true });
  const globalSelection = globalNavigationSelection(props.globalWorkspace, props.globalSection);
  const projectSelection = projectNavigationSelection(props.projectWorkspace || "");
  const groupExpanded = (id: string) => Boolean(expanded[id] || (id === "Knowledge" && globalSelection.parent === "Knowledge" && !props.projectWorkspace));

  useEffect(() => {
    if (!props.open) return;
    openerRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onOpenChange(false);
      if (event.key !== "Tab") return;
      const sidebar = closeButtonRef.current?.closest("aside");
      const focusable = Array.from(sidebar?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [props.open, props.onOpenChange]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeDestination = navigationScrollRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      activeDestination?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.globalWorkspace, props.globalSection, props.projectWorkspace, expanded]);

  const toggle = (id: string) => setExpanded((value) => ({ ...value, [id]: !value[id] }));
  return <>
    <aside className={`sidebar app-navigation ${props.open ? "sidebar-open" : ""}`} aria-label="Primary navigation">
      <button ref={closeButtonRef} className="sidebar-close" onClick={() => props.onOpenChange(false)} aria-label="Close navigation">×</button>
      <div className="brand">
        <div className="brand-mark" aria-hidden="true"><span/><span/><span/></div>
        <div><strong>AI Pricing Agent</strong><small>وكيل التسعير الذكي</small></div>
      </div>

      <div className="app-navigation-scroll" ref={navigationScrollRef} data-shell-region="navigation">
        <nav aria-label="Global navigation" className="global-navigation">
          {GLOBAL_DESTINATIONS.map((item) => {
            const active = globalSelection.parent === item.id && !props.projectWorkspace;
            const locked = Boolean(item.commercial && !props.canViewCommercial);
            return <div className="navigation-group" key={item.id}>
              <button
                className={active ? "nav-active" : ""}
                aria-current={active ? "page" : undefined}
                aria-expanded={item.children ? groupExpanded(item.id) : undefined}
                disabled={locked}
                title={locked ? "Commercial permission required" : undefined}
                onClick={() => item.children ? toggle(item.id) : props.onGlobalNavigate(item.workspace)}
              ><span aria-hidden="true">{item.icon}</span>{item.label}{item.children && <b aria-hidden="true">{groupExpanded(item.id) ? "⌃" : "⌄"}</b>}{locked && <small>Locked</small>}</button>
              {item.children && groupExpanded(item.id) && <div className="navigation-children">
                {item.children.map((child) => {
                  const childActive = globalSelection.child === child.id && !props.projectWorkspace;
                  return <button key={child.id} className={childActive ? "nav-active" : ""} aria-current={childActive ? "page" : undefined}
                    onClick={() => props.onGlobalNavigate(child.workspace, child.section)}>{child.label}</button>;
                })}
              </div>}
            </div>;
          })}
        </nav>

        {props.projectWorkspace && <section className="project-navigation" aria-label="Project navigation">
          <header><small>CURRENT PROJECT</small><strong>{props.projectName}</strong><span>{props.projectStatus || "Loading project status…"}</span></header>
          <nav aria-label="Current project workspaces">
            {PROJECT_NAVIGATION.map((item) => {
              const active = projectSelection.parent === item.id;
              return <div className="navigation-group" key={item.id}>
                <button className={active && !projectSelection.child ? "nav-active" : ""} aria-current={active && !projectSelection.child ? "page" : undefined}
                  aria-expanded={item.children ? Boolean(expanded[item.id]) : undefined}
                  onClick={() => item.children ? toggle(item.id) : props.onProjectNavigate(item.workspace)}>
                  {item.label}{item.children && <b aria-hidden="true">{expanded[item.id] ? "⌃" : "⌄"}</b>}
                </button>
                {item.children && expanded[item.id] && <div className="navigation-children">
                  {item.children.map((child) => {
                    const childActive = projectSelection.child === child.id;
                    return <button key={child.id} className={childActive ? "nav-active" : ""} aria-current={childActive ? "page" : undefined}
                      onClick={() => props.onProjectNavigate(child.workspace)}>{child.label}</button>;
                  })}
                </div>}
              </div>;
            })}
          </nav>
        </section>}
      </div>

      <section className="authenticated-profile" aria-label="Authenticated account">
        <span className="avatar">{props.account.initials}</span>
        <div><strong>{props.account.displayName}</strong><small>{props.account.email}</small><small>{props.account.permission}</small><small>{props.account.organization}</small></div>
        <a href={props.account.signOutUrl}>Sign out</a>
      </section>
    </aside>
    {props.open && <button className="scrim" onClick={() => props.onOpenChange(false)} aria-label="Close navigation overlay"/>}
  </>;
}

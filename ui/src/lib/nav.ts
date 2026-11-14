// Navigation model in BugStage's layout: a few top-level sections shown as
// tabs (top bar on desktop, bottom bar on phones) and, per section, the
// sub-navigation shown in the left sidebar (a drawer on phones).

export interface NavLeaf {
    to: string;
    icon: string;
    labelKey: string;
    // custom active check; defaults to an exact path match
    isActive?: (path: string) => boolean;
}

export interface NavSection {
    id: string;
    to: string;
    icon: string;
    // short label for the tabs
    tabKey: string;
    // path prefixes that belong to the section
    match: string[];
    items: NavLeaf[];
}

export interface NavContext {
    isAuthenticated: boolean;
    isOwner: boolean;
    isBeirat: boolean;
    isAdmin: boolean;
}

const startsWith = (path: string, prefix: string) =>
    prefix === "/" ? path === "/" : path === prefix || path.startsWith(prefix + "/");

export function buildSections(ctx: NavContext): NavSection[] {
    const sections: NavSection[] = [
        {
            id: "home",
            to: "/",
            icon: "ri-home-4-line",
            tabKey: "nav.tab.home",
            match: ["/", "/kontakte", "/meine-einreichungen", "/profile"],
            items: [
                { to: "/", icon: "ri-dashboard-line", labelKey: "nav.overview" },
                { to: "/kontakte", icon: "ri-contacts-book-line", labelKey: "nav.contacts" },
                ...(ctx.isAuthenticated
                    ? [
                          { to: "/meine-einreichungen", icon: "ri-file-list-3-line", labelKey: "nav.mySubmissions" },
                          { to: "/profile", icon: "ri-user-settings-line", labelKey: "nav.profile" },
                      ]
                    : []),
            ],
        },
        {
            id: "news",
            to: "/aktuelles",
            icon: "ri-megaphone-line",
            tabKey: "nav.tab.news",
            match: ["/aktuelles", "/mitreden"],
            items: [
                { to: "/aktuelles", icon: "ri-newspaper-line", labelKey: "nav.announcements" },
                ...(ctx.isOwner ? [{ to: "/mitreden", icon: "ri-chat-poll-line", labelKey: "nav.participate" }] : []),
            ],
        },
        {
            id: "calendar",
            to: "/kalender",
            icon: "ri-calendar-2-line",
            tabKey: "nav.tab.calendar",
            match: ["/kalender", "/events", "/suggestions"],
            items: [
                {
                    to: "/kalender",
                    icon: "ri-calendar-line",
                    labelKey: "nav.calendar",
                    isActive: (p) =>
                        p === "/kalender" || (p.startsWith("/events/") && p !== "/events/new"),
                },
                { to: "/suggestions/new", icon: "ri-calendar-event-line", labelKey: "nav.newSuggestion" },
                ...(ctx.isBeirat ? [{ to: "/events/new", icon: "ri-add-line", labelKey: "nav.newEvent" }] : []),
            ],
        },
        {
            id: "board",
            to: "/issues",
            icon: "ri-map-pin-2-line",
            tabKey: "nav.tab.board",
            match: ["/issues", "/bereiche"],
            items: [
                {
                    to: "/issues",
                    icon: "ri-layout-masonry-line",
                    labelKey: "nav.board",
                    isActive: (p) => startsWith(p, "/issues") && p !== "/issues/new",
                },
                { to: "/issues/new", icon: "ri-error-warning-line", labelKey: "nav.newIssue" },
                ...(ctx.isBeirat ? [{ to: "/bereiche", icon: "ri-map-2-line", labelKey: "nav.areas" }] : []),
            ],
        },
        {
            id: "documents",
            to: "/dokumente",
            icon: "ri-folder-3-line",
            tabKey: "nav.tab.documents",
            match: ["/dokumente"],
            items: [{ to: "/dokumente", icon: "ri-file-text-line", labelKey: "nav.documents" }],
        },
    ];
    if (ctx.isBeirat) {
        sections.push({
            id: "beirat",
            to: "/moderation",
            icon: "ri-shield-user-line",
            tabKey: "nav.tab.beirat",
            match: ["/moderation", "/users", "/notes", "/rechtstexte", "/admin"],
            items: [
                { to: "/moderation", icon: "ri-inbox-2-line", labelKey: "nav.moderation" },
                { to: "/users", icon: "ri-group-line", labelKey: "nav.users" },
                { to: "/notes", icon: "ri-sticky-note-line", labelKey: "nav.notes" },
                { to: "/rechtstexte", icon: "ri-scales-3-line", labelKey: "nav.legal" },
                ...(ctx.isAdmin ? [{ to: "/admin", icon: "ri-user-settings-line", labelKey: "nav.admin" }] : []),
            ],
        });
    }
    return sections;
}

export function activeSection(sections: NavSection[], path: string): NavSection | undefined {
    return sections.find((s) => s.match.some((prefix) => startsWith(path, prefix)));
}

export function isLeafActive(leaf: NavLeaf, path: string): boolean {
    return leaf.isActive ? leaf.isActive(path) : path === leaf.to;
}

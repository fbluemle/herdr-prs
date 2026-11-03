// My pull requests (GitHub, via `gh`): the 15 open ones with the latest activity,
// then the 5 most recently merged or closed. Click a row to open it in the browser.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, window } from "herdr";

const REFRESH_MS = 120000;
const OPEN_COUNT = 15;
const CLOSED_COUNT = 5;
// Search can't sort by close date. Every PR's updatedAt is at or after its closedAt,
// so the most recently closed ones are among the most recently updated: fetch a few
// more than needed and sort by closedAt here.
const CLOSED_FETCH = 20;
const QUERY = `query {
  open: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: ${OPEN_COUNT}) {
    nodes { ... on PullRequest {
      number title url isDraft updatedAt reviewDecision
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
  closed: search(query: "is:pr is:closed author:@me sort:updated-desc", type: ISSUE, first: ${CLOSED_FETCH}) {
    nodes { ... on PullRequest {
      number title url state closedAt
      repository { nameWithOwner }
    } }
  }
}`;

// Opens a URL in the default browser of the machine Herdr runs on.
function openUrl(url) {
  const platform = window().platform;
  if (platform === "macos") return exec("open", [url]);
  if (platform === "linux") return exec("xdg-open", [url]);
  // `start`'s first quoted argument is the window title, hence the "".
  if (platform === "windows") return exec("cmd", ["/c", "start", "", url]);
  throw new Error(`Unsupported platform ${platform}`);
}

function ago(iso) {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// CI rollup -> color and label. No checks at all is its own state, not "passing".
function ci(t, state) {
  switch (state) {
    case "SUCCESS": return { color: t.ansi2, label: "Checks passed" };
    case "FAILURE": case "ERROR": return { color: t.ansi1, label: "Checks failed" };
    case "PENDING": case "EXPECTED": return { color: t.ansi3, label: "Checks running" };
    default: return { color: t.dim, label: "No checks" };
  }
}

function review(t, pr) {
  if (pr.isDraft) return { text: "Draft", color: t.dim };
  switch (pr.reviewDecision) {
    case "APPROVED": return { text: "Approved", color: t.ansi2 };
    case "CHANGES_REQUESTED": return { text: "Changes", color: t.ansi1 };
    case "REVIEW_REQUIRED": return { text: "Review", color: t.ansi3 };
    default: return null;
  }
}

function outcome(t, pr) {
  if (pr.state === "MERGED") return { text: "Merged", color: t.ansi5 };
  if (pr.state === "CLOSED") return { text: "Closed", color: t.ansi1 };
  throw new Error(`Unexpected state ${pr.state} for ${pr.url}`);
}

export default class Prs extends View {
  init(_props, cx) {
    this.open = null; this.closed = null; this.error = null; this.loading = false;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    cx.timer.every(60000, (cx) => cx.notify()); // keeps "3m" honest
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh exited ${r.code}`);
        const data = JSON.parse(r.stdout);
        if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join("; "));
        this.open = data.data.open.nodes;
        this.closed = data.data.closed.nodes
          .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt))
          .slice(0, CLOSED_COUNT);
        this.error = null;
      } catch (e) {
        // The last good lists stay on screen under the error.
        this.error = String(e.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  row(t, pr, { dot, tooltip, tag, time, muted }) {
    return v_flex()
      .id(`pr-${pr.url}`)
      .px(8).py(6).gap(2).rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => openUrl(pr.url))
      .tooltip(tooltip)
      .child(
        h_flex().gap(8).items_center()
          .child(div().w(8).h(8).rounded(4).flex_none().bg(dot))
          .child(div().flex_1().min_w(0).truncate().text_color(muted ? t.muted : t.foreground).child(pr.title)))
      .child(
        h_flex().pl(16).gap(6).items_center().text_size(11.5).text_color(t.dim)
          .child(div().flex_1().min_w(0).truncate().child(`${pr.repository.nameWithOwner}#${pr.number}`))
          .when(tag, (el) => el.child(div().flex_none().text_color(tag.color).child(tag.text)))
          .child(div().flex_none().child(ago(time))));
  }

  openRow(t, pr) {
    const c = ci(t, pr.commits.nodes[0]?.commit.statusCheckRollup?.state);
    return this.row(t, pr, { dot: c.color, tooltip: `${pr.title}\n${c.label}`, tag: review(t, pr), time: pr.updatedAt, muted: pr.isDraft });
  }

  closedRow(t, pr) {
    const o = outcome(t, pr);
    return this.row(t, pr, { dot: o.color, tooltip: `${pr.title}\n${o.text}`, tag: o, time: pr.closedAt, muted: true });
  }

  section(t, label, count) {
    return h_flex().px(8).pt(10).pb(4).gap(6).items_center().text_size(11).font_medium().text_color(t.dim)
      .child(label).child(String(count));
  }

  render() {
    const t = theme();
    const header = h_flex()
      .px(16).h(41).pt(14).pb(5).flex_none().items_center().justify_between()
      .child(
        h_flex().gap(6).items_center().text_size(11.5).font_medium().text_color(t.dim)
          .child(svg("mods/prs/git-pull-request.svg").size(13))
          .child("Pull requests"))
      .child(
        div().id("prs-refresh").text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx))
          .tooltip("Refresh")
          .child(svg("mods/prs/refresh.svg").size(13).when(this.loading, (el) => el.spin(900))));

    const error = this.error && div().px(16).pb(6).text_size(12).text_color(t.ansi1).child(`Couldn't load PRs: ${this.error}`);
    const note = (text) => div().px(8).py(4).text_size(12).text_color(t.dim).child(text);

    let body = null;
    if (this.open) {
      body = v_flex().id("prs-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar()
        .child(this.section(t, "Open", this.open.length))
        .children(this.open.length ? this.open.map((pr) => this.openRow(t, pr)) : [note("No open pull requests.")])
        .child(this.section(t, "Recently closed", this.closed.length))
        .children(this.closed.length ? this.closed.map((pr) => this.closedRow(t, pr)) : [note("None yet.")]);
    } else if (!this.error) {
      body = div().px(16).text_size(12).text_color(t.dim).child("Loading…");
    }

    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13).child(header)
      .when(error, (el) => el.child(error))
      .when(body, (el) => el.child(body));
  }
}

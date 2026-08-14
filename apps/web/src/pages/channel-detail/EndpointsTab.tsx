import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Inbox,
  Info,
  Plug,
  Plus,
  Power,
  X,
} from "lucide-react";
import type { Endpoint } from "@webhook-broadcast/contract";
import { ElapsedTime } from "../../components/ElapsedTime.js";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { PollStatusLine } from "../../components/PollStatusLine.js";
import { SectionTitle } from "../../components/SectionTitle.js";
import { ShortcutsHelp } from "../../components/ShortcutsHelp.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { EnabledStatusLamp } from "../../components/StatusLamp.js";
import { api, describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import { useNow } from "../../lib/elapsedClock.js";
import { formatElapsed } from "../../lib/relativeTime.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { handleRowListKeyDown } from "../../lib/rowListKeyboard.js";
import { EndpointForm, type EndpointFormValues } from "./EndpointForm.js";

// Issue #79: the row-to-row keyboard model (`rowListKeyboard.ts`, issue #53)
// was already implemented on this list's rows — a button per Endpoint,
// `aria-expanded`, an inset well that opens in place — it was only ever missing
// its `data-row-nav` wiring and its own discoverable disclosure. Documented
// here rather than reusing `ACTIVITY_SHORTCUTS`: this list never nests (no
// Delivery-style child list), and Enter/Space open the Endpoint's editor
// rather than a read-only detail well.
const ENDPOINT_SHORTCUTS = [
  { keys: "↑ ↓", description: "Move between Endpoint rows" },
  { keys: "Home / End", description: "Jump to the first or last Endpoint" },
  // Deliberately "Open", not "Open or close": re-activating the row that is
  // already being edited does *not* close it (`handleRowClick` returns early),
  // because closing on a second press would silently discard whatever is
  // half-typed in the form — the exact loss `EndpointSwitchConfirm` exists to
  // prevent. Esc, below, is this list's close, and it runs the form's own
  // Cancel rather than a bare discard.
  { keys: "Enter / Space", description: "Open the focused Endpoint's editor" },
  {
    keys: "Esc",
    description: "Close the open editor, or back out of a pending switch confirmation",
  },
] as const;

/**
 * Issue #52: an auto-disabled Endpoint (ADR 0003) was the interface's one
 * genuinely silent failure — the row named the state and a timestamp and
 * nothing else, so an operator who has not read the ADR could not tell what
 * triggered it, whether it recovers, or what to do. This sits below the row
 * (never inside its `<button>`, so the re-enable action never opens edit
 * mode) in a recessed well, attached to the row it explains rather than a
 * step removed in an edit form.
 *
 * The threshold is named as "the configured auto-disable window" rather than
 * a hardcoded duration: `ENDPOINT_AUTO_DISABLE_AFTER_MS` is not on the wire
 * today, and a deployment may have overridden its default, so printing the
 * built-in default here would be printing a fact that is not necessarily
 * true of this deployment. Stating the rule without the number stays correct
 * either way (issue #52's stated fallback when surfacing the env var would
 * be a disproportionate contract change for this one line of copy).
 */
function EndpointAutoDisabledNotice({
  channelId,
  endpoint,
  onReenabled,
}: {
  channelId: string;
  endpoint: Endpoint;
  onReenabled: () => Promise<void>;
}) {
  const [reenabling, setReenabling] = useState(false);
  const reenablingLabel = useDelayedPending(reenabling);
  const [error, setError] = useState<string | null>(null);

  async function handleReenable(): Promise<void> {
    setReenabling(true);
    setError(null);
    try {
      await api.updateEndpoint(channelId, endpoint.id, { enabled: true });
      await onReenabled();
    } catch (err) {
      setError(describeApiError(err, "Failed to re-enable Endpoint"));
      setReenabling(false);
    }
  }

  return (
    // A consequence advisory, not a confirm region: auto-disable is something
    // the operator is being told about, not a choice they are being asked to
    // confirm. DESIGN.md §5 "Loading, empty, and error" states the treatment
    // and the distinction. The copy's job here is to name the mechanism, its
    // irreversibility, and the remedy.
    <div className="advisory-region well-notice">
      <p className="advisory">
        <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
        <span>
          Auto-disabled: a failure streak, every Delivery failed with no successful Delivery in
          between, held past the configured auto-disable window. It does not recover on its own;
          only an operator re-enabling it resumes Deliveries.
        </span>
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="inline-form">
        {/* Not the filled primary: that is reserved for "the single committing
            action in a plate, one per plate, never two", and this notice
            renders once per auto-disabled Endpoint, so a filled control here
            would stack N of them down one list and spend the accent's 10%
            budget on a failure state — the volume PRODUCT.md principle 4 rules
            out. The tab's one primary stays "Add Endpoint". */}
        <button
          type="button"
          className="control"
          onClick={() => void handleReenable()}
          disabled={reenabling}
        >
          <Power size={13} strokeWidth={1.75} aria-hidden="true" />
          {reenablingLabel ? "Re-enabling…" : "Re-enable"}
        </button>
      </div>
    </div>
  );
}

function endpointLabel(endpoint: Endpoint): string {
  return endpoint.name ?? endpoint.url;
}

/**
 * Issue #74: what the row's name cell prints, which is deliberately *not*
 * `endpointLabel`. That helper falls back to the URL so an aria-label or a
 * confirm sentence can still say which Endpoint it means; inside the row the
 * URL already has its own cell, so falling back there set the same machine
 * string twice — once in bold sans and once in mono — which is the Machine
 * Voice Rule violation the issue names, and left the name track holding a
 * full URL at max-content while the URL track it starved fell back to its
 * pinned minimum for every row in the list. A nameless Endpoint prints
 * nothing here and is identified by the URL cell alone.
 */
function endpointRowLabel(endpoint: Endpoint): string | null {
  return endpoint.name;
}

/**
 * The statistics that trail an Endpoint row, as one ordered list rather than
 * two parallel ones. The cell is the one this family lets truncate, so it
 * needs a `title` carrying the whole string (issue #74) — and building the
 * title and the DOM from the same parts is what stops the two drifting.
 * Notably the elapsed readings are formatted once: a title assembled
 * separately would have printed the raw ISO instants that issue #54 took out
 * of this row in the first place, and disagreed with the text beneath it.
 */
function endpointMetaParts(
  endpoint: Endpoint,
  now: number,
): { key: string; text: string; node: ReactNode }[] {
  const parts: { key: string; text: string; node: ReactNode }[] = [];

  if (endpoint.autoDisabledAt != null) {
    parts.push({
      key: "state",
      text: `since ${formatElapsed(endpoint.autoDisabledAt, now)}`,
      node: (
        <>
          since <ElapsedTime iso={endpoint.autoDisabledAt} focusable={false} />
        </>
      ),
    });
  } else {
    const timeout = endpoint.timeoutMs ? `${endpoint.timeoutMs}ms` : "default timeout";
    parts.push({ key: "state", text: timeout, node: timeout });
  }

  if (endpoint.successRate24h != null) {
    const rate = `${Math.round(endpoint.successRate24h * 100)}% ok (24h)`;
    parts.push({ key: "successRate", text: rate, node: rate });
  }

  if (endpoint.p95Ms != null) {
    const p95 = `p95 ${endpoint.p95Ms}ms`;
    parts.push({ key: "p95", text: p95, node: p95 });
  }

  if (endpoint.lastSuccessAt != null) {
    parts.push({
      key: "lastSuccess",
      text: `last ok ${formatElapsed(endpoint.lastSuccessAt, now)}`,
      node: (
        <>
          last ok <ElapsedTime iso={endpoint.lastSuccessAt} focusable={false} />
        </>
      ),
    });
  }

  return parts;
}

/**
 * Switching straight to a different Endpoint's edit form used to call
 * `setEditingId` again and silently drop whatever was half-typed in the one
 * that was open. This is the same confirm-region idiom the rest of the app
 * already uses for a consequential action (Revoke, Delete Channel): it names
 * what would be lost and requires a second, explicit press, rather than a
 * modal (DESIGN.md #4 grants none) or a silent discard.
 */
function EndpointSwitchConfirm({
  currentLabel,
  targetLabel,
  onDiscardAndSwitch,
  onKeepEditing,
}: {
  currentLabel: string;
  targetLabel: string;
  onDiscardAndSwitch: () => void;
  onKeepEditing: () => void;
}) {
  const discardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    discardRef.current?.focus();
  }, []);

  return (
    <div className="confirm-region">
      <p>
        Unsaved changes to <strong>{currentLabel}</strong>. Discard them and edit{" "}
        <strong>{targetLabel}</strong> instead?
      </p>
      <div className="inline-form">
        <button
          ref={discardRef}
          type="button"
          className="control control-commit"
          onClick={onDiscardAndSwitch}
        >
          <ArrowRightLeft size={13} strokeWidth={1.75} aria-hidden="true" />
          Discard and switch
        </button>
        <button type="button" className="control" onClick={onKeepEditing}>
          <X size={13} strokeWidth={2} aria-hidden="true" />
          Keep editing
        </button>
      </div>
    </div>
  );
}

function EndpointRow({
  endpoint,
  editing,
  pendingSwitchTarget,
  onRowClick,
  onSave,
  onCancelEdit,
  onDirtyChange,
  onDiscardAndSwitch,
  onKeepEditing,
  channelId,
  onReenabled,
}: {
  endpoint: Endpoint;
  editing: boolean;
  pendingSwitchTarget: Endpoint | null;
  onRowClick: (id: string) => void;
  onSave: (input: EndpointFormValues) => Promise<void>;
  onCancelEdit: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onDiscardAndSwitch: () => void;
  onKeepEditing: () => void;
  channelId: string;
  onReenabled: () => Promise<void>;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const now = useNow();
  const label = endpointRowLabel(endpoint);
  const metaParts = endpointMetaParts(endpoint, now);

  // Cancelling the edit returns focus to the row that opened it (DESIGN.md
  // #4 overlay focus contract, issue #61), rather than to <body>. This works
  // without an effect because the row's own `<button>` is never unmounted by
  // opening or closing its well (only the well itself is), so the ref stays
  // valid across the whole edit.
  function cancelEdit(): void {
    onCancelEdit();
    rowRef.current?.focus();
  }

  return (
    // Escape is handled here on the `<li>` rather than on the well below,
    // because the well is a *sibling* of the row's `<button>`, not its
    // ancestor: with the handler on the well, Escape did nothing while focus
    // sat on the row button — which is exactly where the row-to-row keyboard
    // model (issue #53) leaves it after Enter opens the editor. The `<li>`
    // encloses both, so Escape now closes from the row and from inside the
    // form alike, matching the Activity list's own row-plus-well shape.
    <li
      onKeyDown={(event) => {
        // The overlay focus contract (DESIGN.md #4) requires Escape to do
        // exactly what the region's own Cancel-equivalent control does:
        // "Keep editing" while a switch is pending, otherwise the form's own
        // Cancel.
        if (event.key === "Escape" && editing) {
          event.stopPropagation();
          if (pendingSwitchTarget) {
            onKeepEditing();
          } else {
            cancelEdit();
          }
        }
      }}
    >
      <button
        ref={rowRef}
        type="button"
        className="row row-endpoint"
        data-row-nav="true"
        aria-expanded={editing}
        onClick={() => onRowClick(endpoint.id)}
      >
        <EnabledStatusLamp enabled={endpoint.enabled} autoDisabledAt={endpoint.autoDisabledAt} />
        {/* The cell stays in the markup when there is no name so the grid
            lines still agree down the list. It truncates (and so carries its
            own `title`) because a long name is the other way this track could
            reach max-content and starve the URL beside it. */}
        <span className="row-name row-truncate" title={label ?? undefined}>
          {label}
        </span>
        {/* An Endpoint's identity is where it sends, so the URL owns this
            family's flexible column rather than the trailing statistics. It can
            still outrun the column on a long path, so the full value stays
            reachable on hover without opening the editor to read it. */}
        <span className="muted row-truncate" title={endpoint.url}>
          {endpoint.url}
        </span>
        {/* Was a single joined string built from `Date.toLocaleString()`
            fragments (issue #54); elapsed time is a component, not a string,
            so the fragments that carry one render as JSX and the " · "
            separators are only ever inserted between parts that are actually
            present. `focusable={false}` on both: this row is itself the button,
            so each exact instant is revealed from the row's own focus rather
            than from tab stops nested inside it — the `title` here belongs to
            the cell that truncates, not to the timestamps inside it, and it
            prints the same elapsed readings they do. */}
        <span className="row-meta" title={metaParts.map((part) => part.text).join(" · ")}>
          {metaParts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 ? " · " : null}
              {part.node}
            </Fragment>
          ))}
        </span>
        {/* Whether this row opens, and whether it is open now, are shapes at
            rest rather than discoveries (DESIGN.md #5 Rows), matching the
            Activity row this family used to be the one exception to. */}
        <span className="muted row-chevron">
          {editing ? (
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
      </button>
      {endpoint.autoDisabledAt && (
        <EndpointAutoDisabledNotice
          channelId={channelId}
          endpoint={endpoint}
          onReenabled={onReenabled}
        />
      )}
      {editing && (
        // Never a plate nested in a plate: an inset well, the same idiom the
        // Broadcast and Delivery detail use (The Inward Depth Rule). The row
        // stays visible above it (its lamp and name do not disappear while
        // editing), matching `BroadcastDetailPanel`'s row-plus-well shape
        // rather than the row being replaced outright.
        <div
          className="well well-endpoint-edit stack"
          role="group"
          aria-label={`Edit Endpoint ${endpointLabel(endpoint)}`}
        >
          {/*
           * The form itself stays mounted underneath the switch-confirm
           * rather than being replaced by it: unmounting `EndpointForm` would
           * throw away exactly the unsaved field values "Keep editing" is
           * meant to preserve, since that text lives only in its own local
           * state. Showing both keeps the confirm's promise honest.
           */}
          {pendingSwitchTarget && (
            <EndpointSwitchConfirm
              currentLabel={endpointLabel(endpoint)}
              targetLabel={endpointLabel(pendingSwitchTarget)}
              onDiscardAndSwitch={onDiscardAndSwitch}
              onKeepEditing={onKeepEditing}
            />
          )}
          <EndpointForm
            initial={endpoint}
            submitLabel="Save changes"
            submitTreatment="commit"
            onSubmit={onSave}
            onCancel={cancelEdit}
            onDirtyChange={onDirtyChange}
          />
        </div>
      )}
    </li>
  );
}

export function EndpointsTab({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);

  const endpointsQuery = useQuery({
    queryKey: ["endpoints", channelId] as const,
    queryFn: () => api.listEndpoints(channelId),
    refetchInterval: freshnessRefetchInterval,
  });
  useRefetchOnVisible(() => void endpointsQuery.refetch());

  const endpoints: Endpoint[] | null = endpointsQuery.data?.items ?? null;
  const error = endpointsQuery.isError
    ? queryErrorMessage(endpointsQuery.error, "Failed to load Endpoints")
    : null;

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["endpoints", channelId] });
  }

  function closeEditing(): void {
    setEditingId(null);
    setDirty(false);
    setPendingSwitchId(null);
  }

  function handleRowClick(id: string): void {
    if (editingId === id) {
      // Already open: a click here is not a switch away, so any pending
      // switch confirm for a different target no longer applies.
      setPendingSwitchId(null);
      return;
    }
    if (editingId !== null && dirty) {
      setPendingSwitchId(id);
      return;
    }
    setEditingId(id);
    setDirty(false);
    setPendingSwitchId(null);
  }

  return (
    <div className="stack">
      <section className="plate plate-wide stack">
        <SectionTitle icon={<Plus size={13} strokeWidth={2} />}>New Endpoint</SectionTitle>
        <EndpointForm
          onSubmit={async (input) => {
            await api.createEndpoint(channelId, {
              url: input.url,
              ...(input.name !== null ? { name: input.name } : {}),
              ...(input.timeoutMs !== null ? { timeoutMs: input.timeoutMs } : {}),
              headers: input.headers,
              enabled: input.enabled,
            });
            await refresh();
          }}
          submitLabel="Add Endpoint"
        />
      </section>

      {/* A list-only region: see ChannelDirectoryPage's Channels section. */}
      <section className="list-section">
        <SectionTitle icon={<Plug size={13} strokeWidth={2} />}>Endpoints</SectionTitle>
        <PollStatusLine
          dataUpdatedAt={endpointsQuery.dataUpdatedAt}
          isError={endpointsQuery.isError}
        />
        {error && <InlineLoadError message={error} onRetry={() => void endpointsQuery.refetch()} />}
        {endpoints === null && !error && <SkeletonRows label="Loading Endpoints" />}
        {endpoints !== null && endpoints.length === 0 && (
          <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
            No Endpoints yet. Add one above.
          </EmptyState>
        )}
        {endpoints !== null && endpoints.length > 0 && (
          <ul className="row-list row-list-endpoint" onKeyDown={handleRowListKeyDown}>
            {endpoints.map((endpoint) => (
              <EndpointRow
                key={endpoint.id}
                endpoint={endpoint}
                editing={editingId === endpoint.id}
                pendingSwitchTarget={
                  editingId === endpoint.id && pendingSwitchId !== null
                    ? (endpoints.find((candidate) => candidate.id === pendingSwitchId) ?? null)
                    : null
                }
                onRowClick={handleRowClick}
                onSave={async (input) => {
                  await api.updateEndpoint(channelId, endpoint.id, input);
                  closeEditing();
                  await refresh();
                }}
                onCancelEdit={closeEditing}
                onDirtyChange={setDirty}
                onDiscardAndSwitch={() => {
                  const target = pendingSwitchId;
                  setPendingSwitchId(null);
                  setDirty(false);
                  setEditingId(target);
                }}
                onKeepEditing={() => setPendingSwitchId(null)}
                channelId={channelId}
                onReenabled={refresh}
              />
            ))}
          </ul>
        )}
        {/* Last in the section (issue #79), same as Activity: nothing shares
            space with the trigger and nothing sits below it, so opening it
            can never move the trigger or displace the rows above. */}
        <div className="list-shortcuts">
          <ShortcutsHelp items={ENDPOINT_SHORTCUTS} />
        </div>
      </section>
    </div>
  );
}

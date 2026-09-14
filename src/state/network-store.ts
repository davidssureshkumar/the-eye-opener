/**
 * The measured channel: a Touchstone file the reader has loaded, held in memory.
 *
 * A file of a few thousand frequencies is megabytes, far too large for a permalink,
 * and the reader's measurements are theirs, so it is not written to localStorage
 * either. The Scenario carries only what describes it: the file name, the port
 * count and which ports are driven and observed. A link to a Touchstone channel
 * therefore reproduces every setting but the data, and the page says so when the
 * name is set and nothing is loaded.
 *
 * Kept outside the URL store on its own useSyncExternalStore, because the two have
 * different lifetimes: a network survives navigation between modules and dies with
 * the tab.
 */

import { useSyncExternalStore } from 'react';
import { parseTouchstone, TouchstoneError, type TouchstoneFile } from '../sim/touchstone/parser';
import type { Scenario } from './scenario';
import { setScenario, getScenario } from './store';

/** Largest port count the Scenario can address. */
export const MAX_NETWORK_PORTS = 12;

/** Largest file read, bytes. A 4-port sweep of 10 000 points in RI is about 2 MB. */
export const MAX_NETWORK_BYTES = 64 * 1024 * 1024;

export interface LoadedNetwork extends TouchstoneFile {
  /** File name as given. */
  name: string;
  /** File size, bytes. */
  bytes: number;
}

export interface NetworkState {
  file: LoadedNetwork | null;
  /** Why the last file did not load, or null. The previous file, if any, is kept. */
  error: string | null;
  loading: boolean;
}

let state: NetworkState = { file: null, error: null, loading: false };
const listeners = new Set<() => void>();

function update(next: NetworkState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): NetworkState {
  return state;
}

export function useNetworkFile(): NetworkState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Parse text into a network the Scenario can address, or throw a reader-facing error. */
export function readNetworkText(text: string, name: string, bytes = text.length): LoadedNetwork {
  const parsed = parseTouchstone(text, name);
  const { ports, freq } = parsed.network;
  if (ports > MAX_NETWORK_PORTS) {
    throw new TouchstoneError(`${ports} ports; at most ${MAX_NETWORK_PORTS} can be driven here`);
  }
  if (freq.length < 2) throw new TouchstoneError('at least two frequencies are needed');
  return { ...parsed, name, bytes };
}

/**
 * The Scenario after loading a network: its name and port count, a channel model of
 * 'touchstone', the ports clamped into range, and the pairs taken as differential
 * when the port count is even and above two. Everything else is left alone.
 */
export function scenarioForNetwork(s: Scenario, name: string, ports: number): Scenario {
  const ts = s.channel.touchstone;
  const clamp = (p: number, fallback: number) => (p >= 1 && p <= ports ? p : fallback);
  const txPort = clamp(ts.txPort, 1);
  let rxPort = clamp(ts.rxPort, Math.min(2, ports));
  if (rxPort === txPort && ports > 1) rxPort = txPort === 1 ? 2 : 1;
  return {
    ...s,
    channel: {
      ...s.channel,
      kind: 'touchstone',
      touchstone: {
        ...ts,
        name: name.slice(0, 256),
        ports,
        txPort,
        rxPort,
        mixedMode: ports >= 4 && ports % 2 === 0,
      },
    },
  };
}

/** Hold a parsed network and point the Scenario at it. */
export function setNetwork(file: LoadedNetwork): void {
  update({ file, error: null, loading: false });
  // Push, so the back button returns to the channel that was selected before.
  setScenario(scenarioForNetwork(getScenario(), file.name, file.network.ports), false);
}

/** Read a File from an input or a drop. Parsing is on the main thread; see PROGRESS.md. */
export async function loadNetworkFile(file: File): Promise<void> {
  if (file.size > MAX_NETWORK_BYTES) {
    update({
      ...state,
      error: `${file.name} is ${(file.size / 1048576).toFixed(0)} MB; the limit is 64 MB.`,
    });
    return;
  }
  update({ ...state, error: null, loading: true });
  try {
    const text = await file.text();
    setNetwork(readNetworkText(text, file.name, file.size));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    update({ ...state, error: `${file.name}: ${message}`, loading: false });
  }
}

/** Forget the network. The Scenario keeps its name, so a link still says what was used. */
export function clearNetwork(): void {
  update({ file: null, error: null, loading: false });
}

export function __resetNetworkStoreForTests(): void {
  state = { file: null, error: null, loading: false };
}

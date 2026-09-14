import { beforeEach, describe, expect, it } from 'vitest';
import { COUPLING_DEFAULTS, coupledPairNetwork, linearSweep } from '../../sim/touchstone/examples';
import { writeTouchstone } from '../../sim/touchstone/parser';
import { __resetNetworkStoreForTests, readNetworkText, scenarioForNetwork } from '../network-store';
import { encodeScenario, decodeScenario } from '../url-codec';
import { defaultScenario } from '../scenario';

describe('network store', () => {
  beforeEach(() => __resetNetworkStoreForTests());

  it('reads a written network back, with its name and size', () => {
    const s = defaultScenario();
    const net = coupledPairNetwork(s.channel.lossy, COUPLING_DEFAULTS, linearSweep(50e6, 40));
    const text = writeTouchstone(net);
    const loaded = readNetworkText(text, 'pair.s4p');
    expect(loaded.name).toBe('pair.s4p');
    expect(loaded.bytes).toBe(text.length);
    expect(loaded.network.ports).toBe(4);
    expect(loaded.network.freq.length).toBe(40);
  });

  it('turns a parse failure into an error naming the line', () => {
    expect(() => readNetworkText('# HZ S RI R 50\n1e9 0.1 0 0.9\n', 'bad.s2p')).toThrow(/Line/);
  });

  it('points the Scenario at a network, clamping the ports into range', () => {
    const s = defaultScenario();
    const far = {
      ...s,
      channel: { ...s.channel, touchstone: { ...s.channel.touchstone, txPort: 9, rxPort: 1 } },
    };
    const two = scenarioForNetwork(far, 'thru.s2p', 2);
    expect(two.channel.kind).toBe('touchstone');
    expect(two.channel.touchstone).toMatchObject({
      name: 'thru.s2p',
      ports: 2,
      txPort: 1,
      rxPort: 2,
      mixedMode: false,
    });
    const four = scenarioForNetwork(s, 'pair.s4p', 4);
    expect(four.channel.touchstone).toMatchObject({ ports: 4, txPort: 1, rxPort: 2, mixedMode: true });
    // Only the description of the file reaches the permalink, and it round-trips.
    const back = decodeScenario(encodeScenario(four).slice(0)).scenario;
    expect(back.channel.touchstone).toEqual(four.channel.touchstone);
  });
});

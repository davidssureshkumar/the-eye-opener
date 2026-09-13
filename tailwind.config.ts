import type { Config } from 'tailwindcss';
import { surface, signal, signalMuted, fontSize, geometry, font } from './src/design/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: surface.ink900,
          800: surface.ink800,
          700: surface.ink700,
        },
        rule: surface.rule,
        hi: surface.textHi,
        lo: surface.textLo,
        ch1: signal.ch1,
        ch2: signal.ch2,
        ch3: signal.ch3,
        ch4: signal.ch4,
        'ch1-dim': signalMuted.ch1,
        'ch2-dim': signalMuted.ch2,
        'ch3-dim': signalMuted.ch3,
        'ch4-dim': signalMuted.ch4,
      },
      fontFamily: {
        sans: [font.sans],
        mono: [font.mono],
      },
      fontSize: {
        tick: [`${fontSize.tick}px`, '1.2'],
        micro: [`${fontSize.micro}px`, '1.35'],
        readout: [`${fontSize.readout}px`, '1.3'],
        body: [`${fontSize.body}px`, '1.55'],
        lead: [`${fontSize.lead}px`, '1.5'],
        h2: [`${fontSize.h2}px`, '1.25'],
        h1: [`${fontSize.h1}px`, '1.15'],
      },
      borderRadius: {
        sm: `${geometry.radiusSm}px`,
        DEFAULT: `${geometry.radiusMd}px`,
        md: `${geometry.radiusMd}px`,
      },
      spacing: {
        panel: `${geometry.panelWidth}px`,
      },
    },
  },
  plugins: [],
} satisfies Config;

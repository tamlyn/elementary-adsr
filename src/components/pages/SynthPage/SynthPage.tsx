'use client';
import {type RefObject, useCallback, useEffect, useRef, useState} from 'react';
import WebAudioRenderer from '@elemaudio/web-renderer';
import {el} from '@elemaudio/core';

import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '@/../tailwind.config';
import {
  clamp,
  dbMin,
  gainToDecibels,
  LinearSmoothedValue,
  mapTo01Linear,
} from '@/utils/math';
import {keyCodes} from '@/constants/key-codes';
import {Meter} from '@/components/ui/Meter';
import {KnobPercentage} from '@/components/ui/KnobPercentage';
import {KnobAdr} from '@/components/ui/KnobAdr';
import {KnobFrequency} from '@/components/ui/KnobFrequency';
import {InteractionArea} from '@/components/ui/InteractionArea';
import {PlayIcon} from '@/components/icons';
import {SynthContainer} from './SynthContainer';
import {SynthPageSkeleton} from './SynthPageSkeleton';
import {KnobsLayout} from './KnobsLayout';
import {title} from './constants';
import {SynthPageLayout} from './SynthPageLayout';
import {MidiSelector} from '@/components/pages/SynthPage/MidiSelector';
import {noteToFreq} from '@/utils/math/midi';
import {useReducerWithEffect} from '@/components/hooks/useReducerWithEffect';

const {colors} = resolveConfig(tailwindConfig).theme;

export function SynthPage() {
  const [isReady, setIsReady] = useState<boolean>(false);

  const ctxRef = useRef<AudioContext>();
  const coreRef = useRef<WebAudioRenderer>();

  useEffect(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }

    if (!coreRef.current) {
      coreRef.current = new WebAudioRenderer();
    }

    const ctx = ctxRef.current;
    const core = coreRef.current;

    if (ctx.state !== 'running') {
      void ctx.resume();
    }

    core
      .initialize(ctx)
      .then((node) => {
        node.connect(ctx.destination);
      })
      .catch((error) => {
        console.error(error);
      });

    let timeoutId: ReturnType<typeof setTimeout>;

    core.on('load', () => {
      timeoutId = setTimeout(() => {
        setIsReady(true);
      }, 500); // Giving 0.5s more, so UI won't be janky when this component lazy-loaded very quickly.
    });

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  if (!isReady) {
    return <SynthPageSkeleton />;
  }

  const ctx = ctxRef.current;
  const core = coreRef.current;

  if (!ctx) {
    throw new Error("Audio context wasn't initialized properly");
  }

  if (!core) {
    throw new Error("Elementary core wasn't initialized properly");
  }

  return <SynthPageMain core={core} />;
}

type SynthPageMainProps = {
  core: WebAudioRenderer;
};

const numVoices = 8;
const middleC = 60;
const initialState = {
  voices: Array.from({length: numVoices}, () => ({
    note: 60,
    gate: 0,
  })),
  idleVoices: Array.from({length: numVoices}, (_, index) => index),
  activeVoices: [] as number[],
  attack: 0.001,
  decay: 0.6,
  sustain: 0.7,
  release: 0.6,
  gain: 0.5,
};

type State = typeof initialState;

type Action =
  | {
      type: 'controlChange';
      name: 'attack' | 'decay' | 'sustain' | 'release' | 'gain';
      value: number;
    }
  | {type: 'noteOn'; note: number}
  | {type: 'noteOff'; note: number};

const meterLeftSource = 'meter:left';
const meterRightSource = 'meter:right';

function reducer(state: State, action: Action) {
  switch (action.type) {
    case 'controlChange':
      state[action.name] = action.value;
      break;
    case 'noteOn':
      if (state.idleVoices.length > 0) {
        const index = state.idleVoices.shift()!;
        state.voices[index] = {note: action.note, gate: 1};
        state.activeVoices.push(index);
      }

      break;
    case 'noteOff':
      if (state.activeVoices.length > 0) {
        const index = state.activeVoices.find(
          (index) => state.voices[index].note === action.note,
        );
        if (index !== undefined) {
          state.voices[index].gate = 0;
          state.activeVoices.splice(state.activeVoices.indexOf(index), 1);
          state.idleVoices.push(index);
        }
      }

      break;
    default:
      console.warn('Unhandled action', action);
  }

  return state;
}

function SynthPageMain({core}: SynthPageMainProps) {
  const meterLeftRef = useRef<HTMLCanvasElement>(null);
  const meterRightRef = useRef<HTMLCanvasElement>(null);

  useMeter({core, meterRef: meterLeftRef, source: meterLeftSource});
  useMeter({core, meterRef: meterRightRef, source: meterRightSource});

  const [state, dispatch] = useReducerWithEffect(
    initialState,
    reducer,
    useCallback(
      (state) => {
        const renderedVoices = state.voices.map((voice, index) => {
          const attackNode = el.const({
            key: `attack:${index}`,
            value: state.attack,
          });
          const decayNode = el.const({
            key: `decay:${index}`,
            value: state.decay,
          });
          const sustainNode = el.const({
            key: `sustain:${index}`,
            value: state.sustain,
          });
          const releaseNode = el.const({
            key: `release:${index}`,
            value: state.release,
          });
          const sine = el.cycle(noteToFreq(voice.note));
          const gateNode = el.const({key: `gate:${index}`, value: voice.gate});
          const envelope = el.adsr(
            attackNode,
            decayNode,
            sustainNode,
            releaseNode,
            gateNode,
          );
          return el.mul(envelope, sine);
        });
        const gain = el.const({key: 'gain', value: state.gain});
        const out = el.mul(el.add(...renderedVoices), gain);
        core.render(
          el.meter({name: meterLeftSource}, out),
          el.meter({name: meterRightSource}, out),
        );
      },
      [core],
    ),
  );

  const playNote = useCallback(
    (midiNote: number) => {
      dispatch({type: 'noteOn', note: midiNote});
    },
    [dispatch],
  );

  const stopNote = useCallback(
    (midiNote: number) => {
      dispatch({type: 'noteOff', note: midiNote});
    },
    [dispatch],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        // Skip 2nd+ event if key is being held down already
        return;
      }

      if (event.code === keyCodes.space) {
        playNote(middleC);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === keyCodes.space) {
        stopNote(middleC);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [playNote, stopNote]);

  return (
    <SynthPageLayout>
      <SynthContainer
        isActivated
        title={title}
        titleRight={<MidiSelector playNote={playNote} stopNote={stopNote} />}
        meterLeft={<Meter ref={meterLeftRef} />}
        meterRight={<Meter ref={meterRightRef} />}
      >
        <KnobsLayout>
          <KnobInput
            isLarge
            title='Gain'
            kind='percentage'
            value={state.gain}
            onChange={(value) => {
              dispatch({type: 'controlChange', name: 'gain', value});
            }}
          />
          <KnobInput
            title='Attack'
            kind='adr'
            value={state.attack}
            onChange={(value) => {
              dispatch({type: 'controlChange', name: 'attack', value});
            }}
          />
          <KnobInput
            title='Decay'
            kind='adr'
            value={state.decay}
            onChange={(value) => {
              dispatch({type: 'controlChange', name: 'decay', value});
            }}
          />
          <KnobInput
            title='Sustain'
            kind='percentage'
            value={state.sustain}
            onChange={(value) => {
              dispatch({type: 'controlChange', name: 'sustain', value});
            }}
          />
          <KnobInput
            title='Release'
            kind='adr'
            value={state.release}
            onChange={(value) => {
              dispatch({type: 'controlChange', name: 'release', value});
            }}
          />
        </KnobsLayout>
      </SynthContainer>

      <InteractionArea
        icon={<PlayIcon />}
        title="Touch here to play or press the 'Space' key."
        onTouchStart={() => {
          playNote(middleC);
        }}
        onTouchEnd={() => {
          stopNote(middleC);
        }}
        onMouseDown={() => {
          playNote(middleC);
        }}
        onMouseUp={() => {
          stopNote(middleC);
        }}
      />
    </SynthPageLayout>
  );
}

type KnobInputKind = 'percentage' | 'adr' | 'frequency';
type KnobInputProps = {
  isLarge?: boolean;
  kind: KnobInputKind;
  title: string;
  value: number;
  onChange: (value: number) => void;
};
function KnobInput({isLarge, kind, title, value, onChange}: KnobInputProps) {
  const KnobComponent = resolveKnobComponent(kind);
  return (
    <KnobComponent
      isLarge={isLarge}
      title={title}
      value={value}
      defaultValue={value}
      onChange={onChange}
    />
  );
}

const resolveKnobComponent = (kind: KnobInputKind) => {
  switch (kind) {
    case 'percentage':
      return KnobPercentage;
    case 'adr':
      return KnobAdr;
    case 'frequency':
      return KnobFrequency;
    default:
      throw new Error('Unknown knob kind', kind);
  }
};

const useMeter = ({
  core,
  meterRef,
  source,
}: {
  core: WebAudioRenderer;
  meterRef: RefObject<HTMLCanvasElement>;
  source: string;
}) => {
  useEffect(() => {
    const canvas = meterRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const volumeDbMin = dbMin;
    const volumeDbMax = 0;
    const volumeDb = new LinearSmoothedValue(volumeDbMin, volumeDbMin, 0.3);

    type MeterEvent = {
      source?: string;
      min: number;
      max: number;
    };

    core.on('meter', (event: MeterEvent) => {
      if (event.source !== source) {
        return;
      }

      const {min, max} = event;
      const gain = Math.max(Math.abs(min), Math.abs(max));
      const db = clamp(gainToDecibels(gain), volumeDbMin, volumeDbMax);
      if (volumeDb.getCurrentValue() < db) {
        volumeDb.setCurrentAndTargetValue(db);
      } else {
        volumeDb.setTargetValue(db);
      }
    });

    let rafHandle: number | undefined;

    ctx.fillStyle = colors.green;

    const drawMeter = () => {
      const {width, height} = canvas;
      ctx.clearRect(0, 0, width, height);

      const volume01 = mapTo01Linear(
        clamp(volumeDb.getCurrentValue(), volumeDbMin, volumeDbMax),
        volumeDbMin,
        volumeDbMax,
      );
      const meterHeight = height * volume01;
      ctx.fillRect(0, height - meterHeight, width, meterHeight);

      rafHandle = requestAnimationFrame(drawMeter);
    };

    rafHandle = requestAnimationFrame(drawMeter);

    return () => {
      if (rafHandle) {
        cancelAnimationFrame(rafHandle);
      }
    };
  }, [core, meterRef, source]);
};

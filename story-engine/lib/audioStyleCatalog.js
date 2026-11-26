// lib/audioStyleCatalog.js
// Sound is a separate decision from picture. Every voice style carries the
// founder voice law: deep, grown, brisk, bright delivery — never young,
// soft, slow, or whispery — and "Juss" pronounced "just" without the t.
// Music always sits low under the voice, never competing with it.

const FOUNDER_VOICE_LAW_NEGATIVE = Object.freeze([
  'no young-sounding voice',
  'no soft or whispery delivery',
  'no slow drawn-out pacing',
  'no babyish or sing-song tone',
  'never pronounce Juss with a hard t — say "just" without the t',
  'no music competing with the voice'
]);

export const VIDEO_AUDIO_STYLES = Object.freeze({
  founder_voice: {
    label: 'Founder Voice',
    canon: true,
    description: 'The house explainer sound: first-person founder voiceover in a deep, grown, brisk, bright woman\'s voice over a low original music bed.',
    voice: 'first-person founder voiceover; deep, grown, brisk, bright woman\'s voice; confident and warm, spoken like a real person explaining her own product',
    music: 'low original instrumental bed under the voice, warm and unobtrusive, never competing',
    delivery: 'brisk and bright, natural pauses, no drawn-out reads',
    pronunciation: ['Juss = "just" without the t'],
    negative: [...FOUNDER_VOICE_LAW_NEGATIVE]
  },
  founder_voice_male: {
    label: 'Founder Voice — His',
    canon: true,
    description: 'The same founder delivery in a man\'s voice: same tone, same weight, same brisk bright pace.',
    voice: 'first-person founder voiceover; deep, grown, brisk, bright man\'s voice; confident and warm, spoken like a real person explaining his own product',
    music: 'low original instrumental bed under the voice, warm and unobtrusive, never competing',
    delivery: 'brisk and bright, natural pauses, no drawn-out reads',
    pronunciation: ['Juss = "just" without the t'],
    negative: [...FOUNDER_VOICE_LAW_NEGATIVE]
  },
  noir_counsel_narration: {
    label: 'Noir Counsel Narration',
    canon: true,
    description: 'Truth Weaver sound: measured, weighty, plain-language narration over a near-silent bed. Authority without theatrics.',
    voice: 'measured plain-language narration; deep, grown, brisk, bright delivery with weight; every legal term explained in plain words as it lands',
    music: 'near-silent low bed, felt more than heard, no swell under key lines',
    delivery: 'brisk and clear, deliberate pauses before the rule lands',
    pronunciation: ['Juss = "just" without the t'],
    negative: [...FOUNDER_VOICE_LAW_NEGATIVE, 'no courtroom-drama theatrics', 'no whispered gravitas']
  },
  storybook_narration: {
    label: 'Storybook Narration',
    canon: true,
    description: 'Warm grown narration for story and children\'s content over a gentle score. Children\'s visuals and audio stay human-reviewed before publication.',
    voice: 'warm grown storyteller narration; deep, brisk, bright delivery that treats young listeners as smart; characters voiced with clear, consistent identity',
    music: 'gentle original score following the story beats, low under narration',
    delivery: 'brisk and bright with story-shaped pauses, never sing-song',
    pronunciation: ['Juss = "just" without the t'],
    negative: [...FOUNDER_VOICE_LAW_NEGATIVE, 'no babyish voices for child characters', 'no random voice swaps between scenes']
  },
  score_only: {
    label: 'Score Only',
    canon: true,
    description: 'No voiceover. An original music score carries the piece; the picture must read with the sound on or off.',
    voice: null,
    music: 'original instrumental score carrying the full emotional arc, mixed as the lead audio element',
    delivery: 'music-led; cuts land on score beats',
    pronunciation: [],
    negative: ['no voiceover', 'no library stock track feel', 'no music so loud the piece cannot be captioned cleanly']
  },
  silent: {
    label: 'Silent Cut',
    canon: true,
    description: 'No audio track. For loops, previews, and placements that run muted.',
    voice: null,
    music: null,
    delivery: 'silent; every beat must read visually',
    pronunciation: [],
    negative: ['no audio track', 'no beat that only makes sense with sound']
  }
});

export const DEFAULT_AUDIO_STYLE = 'founder_voice';

export function resolveVideoAudio(input = {}) {
  const audioStyle = String(input.audio_style || DEFAULT_AUDIO_STYLE).trim();
  if (!VIDEO_AUDIO_STYLES[audioStyle]) throw new Error('Unsupported audio style.');
  const contract = VIDEO_AUDIO_STYLES[audioStyle];
  return {
    audio_style: audioStyle,
    audio_contract: contract,
    voice_required: Boolean(contract.voice),
    audio_direction: contract.voice
      ? `${contract.voice}. Music: ${contract.music}. Delivery: ${contract.delivery}.`
      : contract.music
        ? `No voiceover. Music: ${contract.music}. Delivery: ${contract.delivery}.`
        : 'Silent cut. No audio track.'
  };
}

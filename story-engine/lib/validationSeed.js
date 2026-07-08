// lib/validationSeed.js

export const VALIDATION_SEED_TYPES = Object.freeze({
  book: {
    label: 'Book Seed',
    proves: ['voice', 'canon', 'characters', 'theme', 'chapter rhythm', 'reader promise'],
    converts_to: ['movie', 'tv', 'comic', 'podcast', 'game', 'ip_deck', 'audiobook', 'short_clip']
  },
  picture_book: {
    label: 'Children’s Book Seed',
    proves: ['age fit', 'lesson', 'visual rhythm', 'emotional safety', 'read-aloud flow'],
    converts_to: ['youtube_short', 'short_clip', 'animated_short', 'song', 'comic', 'parent_guide', 'classroom_activity']
  },
  movie: {
    label: 'Movie Seed',
    proves: ['visual premise', 'scene logic', 'character arc', 'screen tension', 'adaptation potential'],
    converts_to: ['trailer', 'short_clip', 'tv', 'comic', 'game', 'ip_deck']
  },
  tv: {
    label: 'TV Seed',
    proves: ['repeatable engine', 'episode rhythm', 'season arc', 'character ensemble', 'cliffhanger logic'],
    converts_to: ['movie', 'short_clip', 'comic', 'game', 'ip_deck', 'podcast']
  },
  song: {
    label: 'Song Seed',
    proves: ['hook', 'emotion', 'theme', 'voice', 'repeatability'],
    converts_to: ['music_video', 'short_clip', 'performance_concept', 'lyric_video', 'story_scene']
  },
  podcast: {
    label: 'Podcast Seed',
    proves: ['host voice', 'segment rhythm', 'topic promise', 'audience trust', 'repeatable format'],
    converts_to: ['youtube_short', 'article', 'book', 'course', 'short_clip', 'newsletter']
  },
  game: {
    label: 'Game Seed',
    proves: ['player goal', 'choice loop', 'reward logic', 'world rules', 'character agency'],
    converts_to: ['cinematic', 'comic', 'lore_bible', 'movie', 'trailer', 'ip_deck']
  },
  comic: {
    label: 'Comic Seed',
    proves: ['panel rhythm', 'visual identity', 'character silhouette', 'scene compression', 'page turns'],
    converts_to: ['animated_short', 'movie', 'tv', 'game', 'ip_deck', 'short_clip']
  },
  short_clip: {
    label: 'Short Clip Seed',
    proves: ['hook', 'visual payoff', 'platform pacing', 'message clarity', 'shareability'],
    converts_to: ['series', 'ad_campaign', 'youtube_short', 'long_video', 'book_scene']
  },
  ip_deck: {
    label: 'IP Deck Seed',
    proves: ['market positioning', 'adaptation package', 'comparables', 'character sell', 'production readiness'],
    converts_to: ['pitch', 'movie', 'tv', 'game', 'publisher_package']
  }
});

export function normalizeSeedMedium(medium) {
  const value = String(medium || 'book').toLowerCase();
  if (value === 'youtube_short') return 'short_clip';
  if (value === 'animated_short') return 'short_clip';
  if (value === 'series') return 'tv';
  return VALIDATION_SEED_TYPES[value] ? value : 'book';
}

export function getValidationSeedProfile(medium, childrenBookProfile = null) {
  const key = normalizeSeedMedium(medium);
  const base = VALIDATION_SEED_TYPES[key] || VALIDATION_SEED_TYPES.book;
  return {
    seed_medium: key,
    label: childrenBookProfile ? 'Children’s Book Seed' : base.label,
    proves: childrenBookProfile
      ? [...new Set([...base.proves, 'developmental fit', 'learning design', 'child-safe emotional ceiling'])]
      : base.proves,
    converts_to: childrenBookProfile
      ? [...new Set([...base.converts_to, 'youtube_short', 'animated_short', 'parent_guide', 'classroom_activity'])]
      : base.converts_to,
    validation_contract: {
      source_must_be_complete: true,
      source_must_pass_release_gate: false,
      preserve_source_truth: true,
      preserve_audience_promise: true,
      preserve_canon: true,
      conversion_may_change_format: true,
      conversion_may_not_invent_contradictions: true
    }
  };
}

export function seedProofChecklist(seedProfile) {
  return [
    { check: 'source_has_complete_units', description: 'The seed has enough source units to adapt from.' },
    { check: 'source_has_audience_contract', description: 'The seed knows who it is for.' },
    { check: 'source_has_story_promise', description: 'The seed has a clear emotional or informational promise.' },
    { check: 'source_has_canon', description: 'The seed has stable facts, characters, or format rules.' },
    ...seedProfile.proves.map(item => ({ check: `proves_${item.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`, description: `Seed proves ${item}.` }))
  ];
}

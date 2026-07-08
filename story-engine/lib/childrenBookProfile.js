// lib/childrenBookProfile.js

const PROFILES = Object.freeze({
  baby: {
    age_band: '0-3', developmental_stage: 'pre-reader', target_word_count: [0, 250], page_count: 16,
    plot_complexity: 'single emotional beat', conflict_level: 'very gentle', repetition: 'high', rhyme: 'optional',
    page_turn_strategy: 'predictable rhythm', illustration_density: 'every spread', character_count: [1, 3],
    learning_design: 'sensory recognition and naming', discussion_questions: 2, vocabulary_words: 3
  },
  child: {
    age_band: '4-7', developmental_stage: 'early reader', target_word_count: [300, 900], page_count: 32,
    plot_complexity: 'one clear problem and resolution', conflict_level: 'gentle and reassuring', repetition: 'moderate', rhyme: 'optional',
    page_turn_strategy: 'setup and visual payoff', illustration_density: 'every page or spread', character_count: [2, 5],
    learning_design: 'one embedded social or factual idea', discussion_questions: 4, vocabulary_words: 5
  },
  eli5: {
    age_band: 'about 5', developmental_stage: 'curious early learner', target_word_count: [350, 1000], page_count: 32,
    plot_complexity: 'one main goal with visible cause and effect', conflict_level: 'understandable and emotionally safe', repetition: 'moderate', rhyme: 'optional',
    page_turn_strategy: 'question, anticipation, payoff', illustration_density: 'every page or spread', character_count: [2, 5],
    learning_design: 'teach one idea through story action and familiar analogy', discussion_questions: 5, vocabulary_words: 5
  },
  eli10: {
    age_band: 'about 10', developmental_stage: 'independent developing reader', target_word_count: [4000, 18000], page_count: 80,
    plot_complexity: 'main plot plus one simple subplot', conflict_level: 'age-appropriate consequences and emotional nuance', repetition: 'low', rhyme: 'rare',
    page_turn_strategy: 'chapter hooks and escalating questions', illustration_density: 'chapter openings and key scenes', character_count: [3, 8],
    learning_design: 'build systems understanding through cause, effect, and reflection', discussion_questions: 8, vocabulary_words: 10
  },
  middle_grade: {
    age_band: '8-12', developmental_stage: 'middle-grade reader', target_word_count: [20000, 50000], page_count: 160,
    plot_complexity: 'main plot with layered subplots', conflict_level: 'meaningful but age-appropriate', repetition: 'minimal', rhyme: 'none',
    page_turn_strategy: 'chapter hooks and escalating stakes', illustration_density: 'optional spot illustrations', character_count: [4, 12],
    learning_design: 'theme, perspective, and consequence', discussion_questions: 10, vocabulary_words: 12
  }
});

export function getChildrenBookProfile(audience, medium) {
  const key = String(audience || '').toLowerCase();
  const profile = PROFILES[key];
  if (!profile || !['picture_book', 'book', 'series', 'comic'].includes(String(medium || '').toLowerCase())) return null;
  return {
    active: true,
    audience: key,
    medium: String(medium).toLowerCase(),
    ...profile,
    process_requirements: {
      intent_parser: ['resolve age band', 'resolve reading independence', 'resolve educational intent'],
      creative_profile: ['lock developmental stage', 'lock emotional ceiling', 'lock target length'],
      ghost: ['plan age-appropriate plot complexity', 'plan pacing', 'plan illustration beats'],
      lindymode: ['protect tone', 'protect emotional maturity', 'protect audience consistency'],
      ooda: ['choose age-fit structure and escalation'],
      redteam_pre_runtime: ['challenge developmental mismatch', 'challenge unsafe or confusing stakes'],
      runtime: ['draft to reading level', 'honor page or chapter rhythm', 'emit illustration cues'],
      story_memory: ['track vocabulary progression', 'track lessons already taught', 'track emotional promises'],
      learning_engine: ['learn accepted child-facing voice and pacing'],
      playwright: ['verify page/chapter completeness and visual cue presence'],
      redteam_pre_release: ['check reading level', 'check age appropriateness', 'check educational accuracy'],
      artifacts: ['story manuscript', 'illustration brief', 'parent or educator guide', 'vocabulary list', 'discussion questions'],
      release_gate: ['require human approval of child-facing content']
    }
  };
}

export function childrenBookInstruction(profile) {
  if (!profile) return null;
  return [
    `Create for ages ${profile.age_band} at the ${profile.developmental_stage} stage.`,
    `Target ${profile.target_word_count[0]}-${profile.target_word_count[1]} words.`,
    `Use ${profile.plot_complexity}.`,
    `Keep conflict ${profile.conflict_level}.`,
    `Use ${profile.page_turn_strategy} pacing.`,
    `Plan illustrations ${profile.illustration_density}.`,
    `Limit the main cast to roughly ${profile.character_count[0]}-${profile.character_count[1]} characters.`,
    `Learning design: ${profile.learning_design}.`
  ].join(' ');
}

export const CHILDREN_BOOK_PROFILES = PROFILES;

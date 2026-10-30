// MakeVideo browser storyboard v1 -> StoryEngine draft action beats.
// Local-file parsing only: this does not submit, render, approve or publish.
(function (root) {
  'use strict';
  const SCHEMA = 'makevideo/storyboard/v1';
  const PROTOCOL = 'makevideo/v2.1';
  const MAX_SHOTS = 12;
  const MAX_TOTAL_SECONDS = 60;
  function clipped(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }
  function importStoryboard(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.schema !== SCHEMA) {
      throw new Error('Expected a MakeVideo storyboard/v1 JSON file.');
    }
    const shots = input.shots;
    if (!Array.isArray(shots) || shots.length === 0 || shots.length > MAX_SHOTS) {
      throw new Error('StoryEngine supports 1–12 imported shots. Split longer storyboards first.');
    }
    const times = shots.map(shot => {
      if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw new Error('Invalid shot data.');
      const time = shot.duration;
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 2 || time > 12) {
        throw new Error('Each shot must be between 2 and 12 seconds.');
      }
      return time;
    });
    const total = times.reduce((a,b) => a+b, 0);
    if (total > MAX_TOTAL_SECONDS) throw new Error('Imported storyboard exceeds the 60-second StoryEngine planning limit.');
    const directions = shots.map((shot,index) => {
      const description = clipped(shot.visual, 500) || clipped(shot.caption, 180) || clipped(shot.title, 100);
      if (!description) throw new Error('Shot '+(index+1)+' needs visual direction, caption or title.');
      return description.replace(/\s+/g, ' ');
    });
    const format = ['16:9','9:16','1:1'].includes(input.format) ? input.format : '16:9';
    return Object.freeze({
      input_schema: SCHEMA,
      protocol_version: PROTOCOL,
      project_title: clipped(input.title, 100) || 'Untitled',
      aspect_ratio: format,
      viewer_takeaway: clipped(input.goal, 500),
      action_beats: Object.freeze(directions),
      count: directions.length,
      total_seconds: total,
      authority_granted: false,
      submitted: false
    });
  }
  root.MakeVideoStoryboardImport = Object.freeze({ importStoryboard, SCHEMA, PROTOCOL });
})(typeof window !== 'undefined' ? window : globalThis);

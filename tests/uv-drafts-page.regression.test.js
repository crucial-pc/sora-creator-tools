const test = require('node:test');
const assert = require('node:assert/strict');

const createUVDraftsPageModule = require('../uv-drafts-page.js');

const {
  getComposerModelFamily,
  resolveComposerModelValue,
  buildPublicPostPayload,
  extractPublishedPost,
  applyPublishedPostToDraftData,
  extractRemixTargetPostId,
  extractPublishedPostGenerationId,
  buildComposerSourceFromPublishedPost,
  isLargeComposerSizeAllowed,
  normalizeComposerSizeForModel,
  isGenerationDraftId,
  extractErrorMessage,
} = createUVDraftsPageModule.__test;

test('composer model helpers resolve legacy aliases onto canonical backend IDs', () => {
  const models = [
    { value: 'sy_8_20251208', label: 'Sora 2' },
    { value: 'sy_ore', label: 'Sora 2 Pro' },
  ];

  assert.equal(getComposerModelFamily('sora2'), 'sy_8');
  assert.equal(getComposerModelFamily('sora2pro'), 'sy_ore');
  assert.equal(resolveComposerModelValue(models, 'sora2'), 'sy_8_20251208');
  assert.equal(resolveComposerModelValue(models, 'sy_8'), 'sy_8_20251208');
  assert.equal(resolveComposerModelValue(models, 'sora2pro'), 'sy_ore');
  assert.equal(resolveComposerModelValue(models, 'sy_ore'), 'sy_ore');
});

test('buildPublicPostPayload uses the documented share payload shape', () => {
  assert.deepEqual(buildPublicPostPayload('gen_123', 'hello world'), {
    post_text: 'hello world',
    attachments_to_create: [
      {
        kind: 'sora',
        generation_id: 'gen_123',
      },
    ],
    destinations: [{ type: 'public' }],
  });
});

test('extractPublishedPost accepts nested post responses', () => {
  const payload = {
    item: {
      post: {
        id: 's_123',
        permalink: '/p/s_123',
      },
    },
  };

  assert.deepEqual(extractPublishedPost(payload), {
    id: 's_123',
    permalink: '/p/s_123',
  });
});

test('applyPublishedPostToDraftData marks drafts public and clears scheduled state', () => {
  const draft = {
    id: 'gen_123',
    scheduled_post_id: 'schedule_gen_123',
    scheduled_post_at: 123456789,
    scheduled_post_status: 'pending',
    scheduled_post_caption: 'queued caption',
    post_meta: {
      share_ref: 'old_ref',
    },
  };

  const updated = applyPublishedPostToDraftData(draft, {
    id: 's_123',
    permalink: '/p/s_123',
    share_ref: 'share_ref_1',
    permissions: { share_setting: 'public' },
  });

  assert.equal(updated.post_id, 's_123');
  assert.equal(updated.post_permalink, '/p/s_123');
  assert.equal(updated.post_visibility, 'public');
  assert.equal(updated.posted_to_public, true);
  assert.deepEqual(updated.post_meta, {
    id: 's_123',
    permalink: '/p/s_123',
    visibility: 'public',
    posted_to_public: true,
    share_ref: 'share_ref_1',
    share_setting: 'public',
  });
  assert.equal('scheduled_post_id' in updated, false);
  assert.equal('scheduled_post_at' in updated, false);
  assert.equal('scheduled_post_status' in updated, false);
  assert.equal('scheduled_post_caption' in updated, false);
});

test('extractRemixTargetPostId prefers nested published remix targets from draft payloads', () => {
  const apiDraft = {
    creation_config: {
      remix_target_post: {
        post: {
          id: 's_parent_123',
        },
      },
    },
  };

  assert.equal(extractRemixTargetPostId(apiDraft), 's_parent_123');
  assert.equal(extractRemixTargetPostId({}, { remix_target_post_id: 's_existing_456' }), 's_existing_456');
  assert.equal(extractRemixTargetPostId({ creation_config: { remix_target_post: { id: 'gen_parent_789' } } }), 'gen_parent_789');
});

test('buildComposerSourceFromPublishedPost preserves post media and any embedded generation ID', () => {
  const source = buildComposerSourceFromPublishedPost({
    id: 's_parent_123',
    post_text: 'Remix this published clip',
    attachments: [
      {
        generation_id: 'gen_parent_123',
        width: 640,
        height: 360,
        n_frames: 300,
        encodings: {
          source: { path: 'https://videos.openai.com/source.mp4' },
          thumbnail: { path: 'https://videos.openai.com/thumb.jpg' },
        },
      },
    ],
  });

  assert.equal(extractPublishedPostGenerationId({ attachments: [{ generation_id: 'gen_parent_123' }] }), 'gen_parent_123');
  assert.deepEqual(source, {
    type: 'post',
    id: 'gen_parent_123',
    post_id: 's_parent_123',
    storyboard_id: '',
    can_storyboard: false,
    prompt: 'Remix this published clip',
    title: '',
    url: 'https://videos.openai.com/source.mp4',
    preview_url: 'https://videos.openai.com/source.mp4',
    thumbnail_url: 'https://videos.openai.com/thumb.jpg',
    orientation: 'landscape',
    duration_seconds: 10,
    cameo_profiles: [],
    label: 'Remix this published clip',
  });
});

test('large size is restricted to Sora 2 Pro unless ultra mode is enabled', () => {
  assert.equal(isGenerationDraftId('gen_123'), true);
  assert.equal(isGenerationDraftId('s_123'), false);
  assert.equal(isLargeComposerSizeAllowed('sy_ore', false), true);
  assert.equal(isLargeComposerSizeAllowed('sy_8', false), false);
  assert.equal(isLargeComposerSizeAllowed('sy_8', true), true);
  assert.equal(normalizeComposerSizeForModel('large', 'sy_ore', false), 'large');
  assert.equal(normalizeComposerSizeForModel('large', 'sy_8', false), 'small');
  assert.equal(normalizeComposerSizeForModel('large', 'sy_8', true), 'large');
});

test('extractErrorMessage prefers nested backend message fields over object stringification', () => {
  assert.equal(
    extractErrorMessage({ error: { message: 'Rate limit exceeded' } }),
    'Rate limit exceeded'
  );
  assert.equal(
    extractErrorMessage({ detail: { message: 'Model not allowed' } }),
    'Model not allowed'
  );
  assert.match(
    extractErrorMessage({ error: { code: 'bad_request' } }, 'Unknown error'),
    /bad_request/
  );
});

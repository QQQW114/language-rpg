// localStorage 桩必须在 store 模块求值前安装（persist 在顶层读它）。
import { clearPersisted } from './helpers/localStorageStub';

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, useSettingsStore } from '@/store/useSettingsStore';
import { DEFAULT_SETTINGS } from '@/types/settings';

const store = () => useSettingsStore.getState();

beforeEach(() => {
  clearPersisted();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe('useSettingsStore — 故事阶段独立连接（混合端点）', () => {
  it('旧设置缺字段时两个字段归一为空串（空串 = 继承全局）', () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.storyApiBaseUrl;
    delete legacy.storyApiKey;
    const settings = normalizeSettings(legacy as never);
    assert.equal(settings.storyApiBaseUrl, '');
    assert.equal(settings.storyApiKey, '');
    // 空串只表示继承，全局连接原样保留
    assert.equal(settings.apiBaseUrl, DEFAULT_SETTINGS.apiBaseUrl);
    assert.equal(settings.apiKey, DEFAULT_SETTINGS.apiKey);
  });

  it('显式填写的故事连接原样保留', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      storyApiBaseUrl: 'https://story.example/v1',
      storyApiKey: 'story-secret',
    });
    assert.equal(settings.storyApiBaseUrl, 'https://story.example/v1');
    assert.equal(settings.storyApiKey, 'story-secret');
    // 独立连接不应影响全局连接
    assert.equal(settings.apiBaseUrl, DEFAULT_SETTINGS.apiBaseUrl);
  });

  it('base / key 分别独立继承：只覆盖其中一个时另一个仍是空串', () => {
    const onlyBase = normalizeSettings({ ...DEFAULT_SETTINGS, storyApiBaseUrl: 'https://story.example/v1' });
    assert.equal(onlyBase.storyApiBaseUrl, 'https://story.example/v1');
    assert.equal(onlyBase.storyApiKey, '');

    const onlyKey = normalizeSettings({ ...DEFAULT_SETTINGS, storyApiKey: 'story-secret' });
    assert.equal(onlyKey.storyApiBaseUrl, '');
    assert.equal(onlyKey.storyApiKey, 'story-secret');
  });

  it('坏值（null / 数字 / 对象）归一为空串，不把非法值带进请求', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      storyApiBaseUrl: null,
      storyApiKey: 42,
    } as never);
    assert.equal(settings.storyApiBaseUrl, '');
    assert.equal(settings.storyApiKey, '');
  });

  it('update 后保留独立连接（更新其它字段不冲掉），reset 回到空串继承', () => {
    store().update({ storyApiBaseUrl: 'https://story.example/v1', storyApiKey: 'story-secret' });
    assert.equal(store().settings.storyApiBaseUrl, 'https://story.example/v1');
    assert.equal(store().settings.storyApiKey, 'story-secret');

    // 更新其它字段不应把独立连接清空
    store().update({ storyModel: 'gemini-4-argon' });
    assert.equal(store().settings.storyApiBaseUrl, 'https://story.example/v1');
    assert.equal(store().settings.storyApiKey, 'story-secret');

    store().reset();
    assert.equal(store().settings.storyApiBaseUrl, '');
    assert.equal(store().settings.storyApiKey, '');
  });

  it('默认设置就是空串继承，不强制玩家配置独立端点', () => {
    assert.equal(DEFAULT_SETTINGS.storyApiBaseUrl, '');
    assert.equal(DEFAULT_SETTINGS.storyApiKey, '');
  });
});

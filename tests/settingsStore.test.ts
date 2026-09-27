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

describe('useSettingsStore — 思考强度', () => {
  it('low 档会被保留（回归：曾被硬编码成 max/high 二选一而静默改回 high）', () => {
    assert.equal(normalizeSettings({ reasoningEffort: 'low' }).reasoningEffort, 'low');
    assert.equal(normalizeSettings({ reasoningEffort: 'high' }).reasoningEffort, 'high');
    assert.equal(normalizeSettings({ reasoningEffort: 'max' }).reasoningEffort, 'max');
    // 非法值回退默认
    assert.equal(normalizeSettings({ reasoningEffort: 'ultra' as never }).reasoningEffort, DEFAULT_SETTINGS.reasoningEffort);
  });

  it('按模型设置被保留，非法档位与空模型名被剔除', () => {
    const settings = normalizeSettings({
      reasoningEffortByModel: {
        'deepseek-flash': 'low',
        'deepseek-v4-pro': 'max',
        '  带空格  ': 'high',
        '': 'low',
        'bad-value': 'ultra',
      } as never,
    } as never);
    assert.deepEqual(settings.reasoningEffortByModel, {
      'deepseek-flash': 'low',
      'deepseek-v4-pro': 'max',
      '带空格': 'high',
    });
  });

  it('按模型设置经 update 后仍然生效', () => {
    store().update({ reasoningEffortByModel: { 'deepseek-flash': 'low' } });
    assert.equal(store().settings.reasoningEffortByModel?.['deepseek-flash'], 'low');
    // 再更新别的字段不应把它冲掉
    store().update({ reasoningEffort: 'max' });
    assert.equal(store().settings.reasoningEffortByModel?.['deepseek-flash'], 'low');
    assert.equal(store().settings.reasoningEffort, 'max');
  });

  it('旧存档的"逐阶段"设置会折算进对应模型的档位（避免升级后静默丢弃）', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      storyModel: 'story-model-x',
      plannerModel: 'planner-model-y',
      // 旧版本只有"按阶段"这一种覆盖方式
      reasoningEffortByPhase: { story: 'low', planner_post: 'max', planner_pre: 'max' },
    } as never);
    // 折算结果：故事阶段 → 故事模型，规划与结算阶段 → 规划模型
    assert.equal(settings.reasoningEffortByModel?.['story-model-x'], 'low');
    assert.equal(settings.reasoningEffortByModel?.['planner-model-y'], 'max');
    // 逐阶段的原始设置仍然保留（它优先级更高）
    assert.equal(settings.reasoningEffortByPhase?.planner_post, 'max');
  });

  it('已存在的按模型设置优先，不被旧阶段设置覆盖', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      storyModel: 'story-model-x',
      reasoningEffortByPhase: { story: 'low' },
      reasoningEffortByModel: { 'story-model-x': 'max' },
    } as never);
    assert.equal(settings.reasoningEffortByModel?.['story-model-x'], 'low', '阶段设置折算时覆盖同名模型的旧值');
  });

  it('未设置任何覆盖时为空对象，不会凭空产生条目', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS);
    assert.deepEqual(settings.reasoningEffortByModel, {});
    assert.deepEqual(settings.reasoningEffortByPhase, {});
  });
});

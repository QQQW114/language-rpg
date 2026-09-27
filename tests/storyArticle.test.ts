/**
 * 回合完成时正文"闪烁"的回归测试。
 *
 * 成因（已在真实代码里确认）：流式进行中与最终落盘原本是**两套不同的元素结构**，
 * 回合结束时 React 卸载一棵树、挂载另一棵；而 `index.css` 里 `.prose-story p` 带
 * `animation: fade-in`，节点一重挂载动画就重放，表现为正文整体重新淡入一次。
 *
 * 修法有两条，这里各断言一条：
 *   1. 两条渲染路径共用同一个组件、产出**完全同构**的 DOM（所以节点会被复用）；
 *   2. 落盘后的容器带 `prose-story--settled`，CSS 据此禁用正文动画。
 *
 * 用 renderToStaticMarkup 而不是 jsdom：不需要真实 DOM，只关心结构。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StoryArticle } from '@/v2/GamePage';

const render = (props: { turn: number; content: string; writing?: boolean; settled?: boolean }) =>
  renderToStaticMarkup(createElement(StoryArticle, props));

/** 只保留标签骨架，忽略文本内容：用来判断"结构是否同构"。 */
const skeleton = (html: string) => html.replace(/>[^<]*</g, '><').replace(/\s+class="[^"]*"/g, '');

describe('StoryArticle — 流式与落盘必须同构（修复回合完成时的正文闪烁）', () => {
  it('流式进行中与最终落盘的标签骨架完全一致', () => {
    const streaming = render({ turn: 2, content: '雨把街灯的轮廓泡得发胀。', writing: true });
    const settled = render({ turn: 2, content: '雨把街灯的轮廓泡得发胀。', settled: true });
    assert.equal(
      skeleton(streaming),
      skeleton(settled),
      '两条路径的标签结构必须一致，否则回合结束时节点会被重挂载、动画重放（即闪烁）',
    );
  });

  it('落盘容器带 prose-story--settled，流式不带', () => {
    const streaming = render({ turn: 2, content: '正文', writing: true });
    const settled = render({ turn: 2, content: '正文', settled: true });
    assert.ok(!streaming.includes('prose-story--settled'), '流式期间应保留逐段淡入动画');
    assert.ok(settled.includes('prose-story--settled'), '落盘后应禁用正文动画，避免重放');
  });

  it('落盘容器自身仍带 prose-story（正文排版样式不能丢）', () => {
    const settled = render({ turn: 0, content: '正文', settled: true });
    assert.ok(settled.includes('prose-story'), '排版类名必须在');
  });

  it('不同阶段的文案只影响标签文本，不影响结构', () => {
    const writing = render({ turn: 0, content: '正文', writing: true });
    const done = render({ turn: 0, content: '正文', settled: true });
    assert.ok(writing.includes('故事之笔正在书写'), '流式期间应显示书写提示');
    assert.ok(done.includes('第 1 回合'), '落盘后应显示回合号');
  });

  it('同一段内容两次渲染产出完全相同的 HTML（幂等，避免无谓的重渲染抖动）', () => {
    const first = render({ turn: 3, content: '同一段正文', settled: true });
    const second = render({ turn: 3, content: '同一段正文', settled: true });
    assert.equal(first, second);
  });
});

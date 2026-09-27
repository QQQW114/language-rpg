import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, clsx, extractJSON, extractJSONText, formatTemplate, genId, tail } from '@/lib/utils';

describe('utils.extractJSONText', () => {
  it('裸 JSON 原样返回', () => {
    assert.equal(extractJSONText('{"a":1}'), '{"a":1}');
  });

  it('去掉 ```json 包裹并保留内部 JSON', () => {
    assert.equal(extractJSONText('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(extractJSONText('```\n{"a":1}\n```'), '{"a":1}');
  });

  it('前后有解释文字时只取 JSON 对象', () => {
    assert.equal(extractJSONText('好的，结果如下：{"a":1,"b":"文字"} 以上。'), '{"a":1,"b":"文字"}');
    assert.equal(
      extractJSONText('说明\n```json\n{"a":1}\n```\n结束语'),
      '{"a":1}',
    );
  });

  it('嵌套对象保持完整', () => {
    assert.equal(extractJSONText('前缀 {"a":{"b":[1,2]}} 后缀'), '{"a":{"b":[1,2]}}');
  });

  it('非法 JSON / 没有对象时返回 null', () => {
    assert.equal(extractJSONText('{a:1}'), null);
    assert.equal(extractJSONText('这里没有对象'), null);
    assert.equal(extractJSONText(''), null);
    assert.equal(extractJSONText('{'), null);
  });

  it('多个对象分别包在 code fence 里时取第一个 fence', () => {
    assert.equal(
      extractJSONText('```json\n{"first":1}\n```\n以及\n```json\n{"second":2}\n```'),
      '{"first":1}',
    );
  });

  it('未加 fence 的多个对象：返回首个可解析对象（回归：曾因贪婪匹配整体失败）', () => {
    assert.equal(extractJSONText('{"a":1} 以及 {"b":2}'), '{"a":1}');
    assert.deepEqual(extractJSON('{"a":1} 以及 {"b":2}'), { a: 1 });
  });

  it('前一个片段非法时继续尝试后面的对象', () => {
    assert.equal(extractJSONText('{a:1} 然后 {"b":2}'), '{"b":2}');
    assert.deepEqual(extractJSON('{a:1} 然后 {"b":2}'), { b: 2 });
  });

  it('跳过字符串字面量内部的括号，不被正文里的 } 提前截断', () => {
    assert.equal(
      extractJSONText('{"note":"} 不是结尾","b":2} 说明'),
      '{"note":"} 不是结尾","b":2}',
    );
    assert.deepEqual(
      extractJSON('{"note":"} 不是结尾","b":2} 说明'),
      { note: '} 不是结尾', b: 2 },
    );
  });

  it('转义引号不会破坏括号平衡判断', () => {
    assert.deepEqual(
      extractJSON('{"quote":"他说：\\"结束\\"","n":1}'),
      { quote: '他说："结束"', n: 1 },
    );
  });

  it('外层被截断时不退而返回内层对象（截断必须是 null 而非误导性结果）', () => {
    // 回归：曾经会跳过未闭合的外层 '{'，在内层 '{' 上匹配到 {"b":1}。
    assert.equal(extractJSONText('{"a":{"b":1}'), null);
    assert.equal(extractJSON('{"a":{"b":1}'), null);
    // 尾部未闭合时同样不能给出内层结果。
    assert.equal(extractJSONText('{"a":1,"b":{"c":2}'), null);
  });

  it('合法对象在前、非法 fence 在后时保留前面的对象', () => {
    assert.equal(extractJSONText('{"a":1}\n```\n{oops}\n```'), '{"a":1}');
  });

  it('病态输入（大量未闭合括号）必须快速返回 null 而不是卡死', () => {
    // 回归：逐 '{' 扫描曾退化成 O(n²)，200KB 输入实测超过两分钟。
    const started = Date.now();
    assert.equal(extractJSONText('{'.repeat(200_000)), null);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `预期 <1000ms，实际 ${elapsed}ms`);
  });
});

describe('utils.extractJSON', () => {
  it('解析为对象', () => {
    assert.deepEqual(extractJSON('结果：{"a":1,"b":[2]}'), { a: 1, b: [2] });
  });

  it('非法输入返回 null 而不是抛错', () => {
    assert.equal(extractJSON('不是 JSON'), null);
    assert.equal(extractJSON('{bad}'), null);
    assert.equal(extractJSON(''), null);
  });

  it('可以按泛型取标量字段', () => {
    const parsed = extractJSON<{ intent: string }>('{"intent":"试探"}');
    assert.equal(parsed?.intent, '试探');
  });
});

describe('utils.clamp', () => {
  it('夹在区间内', () => {
    assert.equal(clamp(5, 1, 3), 3);
    assert.equal(clamp(-5, 1, 3), 1);
    assert.equal(clamp(2, 1, 3), 2);
  });

  it('NaN 会继续传播（当前实现不做兜底）', () => {
    assert.ok(Number.isNaN(clamp(Number.NaN, 0, 10)));
  });
});

describe('utils.tail', () => {
  it('取末尾 n 个字符', () => {
    assert.equal(tail('abcdef', 3), 'def');
  });

  it('短于 n 时原样返回', () => {
    assert.equal(tail('ab', 5), 'ab');
  });

  it('空串返回空串', () => {
    assert.equal(tail('', 3), '');
  });
});

describe('utils.formatTemplate', () => {
  it('替换已提供的变量', () => {
    assert.equal(formatTemplate('你好{{name}}，欢迎。', { name: '阿黎' }), '你好阿黎，欢迎。');
  });

  it('缺变量替换为空串', () => {
    assert.equal(formatTemplate('你好{{name}}，{{missing}}', { name: '阿黎' }), '你好阿黎，');
    assert.equal(formatTemplate('[{{a}}]', { a: undefined }), '[]');
    assert.equal(formatTemplate('[{{a}}]', {}), '[]');
  });

  it('数字变量会被字符串化', () => {
    assert.equal(formatTemplate('{{n}}次', { n: 3 }), '3次');
    assert.equal(formatTemplate('{{n}}次', { n: 0 }), '0次');
  });

  it('只替换 \\w+ 形式的占位符', () => {
    assert.equal(formatTemplate('{{a-b}}', {}), '{{a-b}}');
  });
});

describe('utils.clsx / genId', () => {
  it('clsx 过滤假值并拼接', () => {
    assert.equal(clsx('a', false, undefined, null, 'b'), 'a b');
    assert.equal(clsx(false, null), '');
  });

  it('genId 带前缀且基本唯一', () => {
    const ids = new Set(Array.from({ length: 200 }, () => genId('char')));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.ok(id.startsWith('char_'), `前缀不正确：${id}`);
  });
});

import { describe, expect, it } from 'vitest';
import { applyCase } from '../src/index.js';

// IntelliJ's own cases (`PreserveCaseUtilTest.testApplyCase`), found first.
describe('applyCase', () => {
  it('takes the case of the found text, as IntelliJ’s tests', () => {
    const cases: [found: string, replacement: string, expected: string][] = [
      ['Bar', 'foo', 'Foo'],
      ['bar', 'foo', 'foo'],
      ['BAR', 'foo', 'FOO'],
      ['Bar', 'Foo', 'Foo'],
      ['bar', 'Foo', 'foo'],
      ['BAR', 'Foo', 'FOO'],
      ['Bar', 'FOO', 'Foo'],
      ['bar', 'FOO', 'foo'],
      ['BAR', 'FOO', 'FOO'],
      ['Bar', 'fooBar', 'FooBar'],
      ['bar', 'fooBar', 'fooBar'],
      ['abc1', 'DEF1', 'def1'],
      ['Abc1', 'DEF1', 'Def1'],
      ['ABC1', 'DEF1', 'DEF1'],
      ['a1', 'abc', 'abc'],
      ['A1', 'abc', 'ABC'],
      ['display preferences', 'Report', 'report'],
      ['DISPLAY PREFERENCES', 'Report', 'REPORT'],
      ['display Preferences', 'Report', 'report'],
      ['Display preferences', 'Report', 'Report'],
      ['USERCODE', 'MyTest', 'MYTEST'],
      ['UserCode', 'MyTest', 'MyTest'],
      ['userCode', 'MyTest', 'myTest'],
      ['report', 'display preferences', 'display preferences'],
      ['REPORT', 'display preferences', 'DISPLAY PREFERENCES'],
      ['Report', 'display preferences', 'Display Preferences'],
      ['Project_Lead_Id', 'PROGRAM_LEAD_ID', 'Program_Lead_Id'],
      ['niceWeather', 'SUN_SHINE', 'sun_shine'],
      ['niceweather', 'SUN_SHINE', 'sun_shine'],
      ['111', 'do nothing', 'do nothing'],
      ['111', 'Do Nothing', 'Do Nothing'],
      ['111', 'DO NOTHING', 'DO NOTHING'],
      ['111', '222', '222'],
      ['Test_String', 'string_test', 'String_Test'],
      ['Case', '_case', '_Case'],
      ['control.search', 'control.SearchControl', 'control.searchControl'],
      ['control.Search', 'control.SearchControl', 'control.SearchControl'],
    ];
    expect(cases.map(([found, replacement]) => applyCase(found, replacement))).toEqual(
      cases.map(([, , expected]) => expected),
    );
  });

  it('leaves the replacement when there’s nothing to take the case of', () => {
    expect(applyCase('', 'Foo')).toBe('Foo');
    expect(applyCase('---', 'Foo')).toBe('Foo');
    expect(applyCase('Bar', '')).toBe('');
  });
});

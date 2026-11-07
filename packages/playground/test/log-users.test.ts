import { describe, expect, it } from 'vitest';
import {
  displayable,
  exactly,
  ME,
  nameFromEmail,
  read,
  resolveUsers,
  shown,
  standardForm,
  userNames,
} from '../src/log-users.js';

describe('the User filter’s names', () => {
  it('compare as IntelliJ’s: a first and last name in lower case, else the name in lower case', () => {
    expect(standardForm('Ada Lovelace')).toBe('ada lovelace');
    expect(standardForm('ada.LOVELACE')).toBe('ada lovelace');
    expect(standardForm('Ada King Lovelace')).toBe('ada king lovelace');
    // Not printable ASCII: as it is.
    expect(standardForm('Zoë')).toBe('Zoë');
  });

  it('take an email’s part before the @, if there is one before it', () => {
    expect(nameFromEmail('ada@x')).toBe('ada');
    expect(nameFromEmail('@x')).toBeUndefined();
    expect(nameFromEmail('ada')).toBeUndefined();
  });

  it('give an author exactly, as git’s --author is given it', () => {
    expect(exactly({ name: 'Ada', email: 'ada@x' })).toBe('Ada <ada@x>');
    expect(exactly({ name: '', email: 'ada@x' })).toBe('ada@x');
    expect(exactly({ name: 'Ada', email: '' })).toBe('Ada');
  });

  it('stand for every author of that name, or of that email before the @', () => {
    const authors = [
      { name: 'Ada Lovelace', email: 'ada@x' },
      { name: 'Someone', email: 'ada.lovelace@y' },
      { name: '', email: 'bob@x' },
      { name: 'Bob', email: 'bob@y' },
    ];
    expect(resolveUsers(['ada.lovelace'], authors, undefined)).toEqual([
      'Ada Lovelace <ada@x>',
      'Someone <ada.lovelace@y>',
    ]);
    // "me": by the name, and by the email's name only with an email the name found.
    expect(resolveUsers([ME], authors, { name: 'Bob', email: 'none' })).toEqual([
      'bob@x',
      'Bob <bob@y>',
    ]);
    expect(resolveUsers([ME], authors, { name: 'Robert', email: 'bob@x' })).toEqual([]);
    expect(resolveUsers([ME], authors, { name: 'Ada Lovelace', email: 'ada.lovelace@y' })).toEqual([
      'Ada Lovelace <ada@x>',
      'Someone <ada.lovelace@y>',
    ]);
    expect(resolveUsers([ME, 'bob'], authors, undefined)).toEqual(['bob@x', 'Bob <bob@y>']);
  });

  it('list the authors by short name, once each, a first and last name capitalized', () => {
    expect(
      userNames([
        { name: 'ada lovelace', email: 'a@x' },
        { name: 'Ada Lovelace', email: 'b@x' },
        { name: '', email: 'bob@x' },
        { name: '', email: 'nobody' },
        { name: 'zoë', email: 'z@x' },
      ]),
    ).toEqual(['Ada Lovelace', 'bob', 'nobody', 'zoë']);
  });

  it('show "me" for the user, and read it back', () => {
    expect(shown([ME, 'Ada'])).toEqual(['me', 'Ada']);
    expect(read(['me', 'Ada'])).toEqual([ME, 'Ada']);
  });

  it('show between bars, cut short with an ellipsis past 20 characters', () => {
    expect(displayable(['Ada'])).toBe('Ada');
    expect(displayable(['Ada Lovelace', 'Bob Smith'])).toBe('Ada Lovelace|Bob Sm…');
    expect(displayable(['Ada Lovelace', 'Bob Smith'], 40)).toBe('Ada Lovelace|Bob Smith');
  });
});

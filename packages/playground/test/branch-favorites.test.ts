import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFavorite, readFavorites, setFavorite } from '../src/branch-favorites.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('favorite branches', () => {
  it('are main and master, local and on origin, until unmarked; any other once marked; for each repository', () => {
    expect(isFavorite('/a', 'refs/heads/main')).toBe(true);
    expect(isFavorite('/a', 'refs/remotes/origin/master')).toBe(true);
    expect(isFavorite('/a', 'refs/remotes/up/main')).toBe(false);
    expect(isFavorite('/a', 'refs/heads/side')).toBe(false);
    setFavorite('/a', 'refs/heads/side', true);
    setFavorite('/a', 'refs/heads/main', false);
    expect(isFavorite('/a', 'refs/heads/side')).toBe(true);
    expect(isFavorite('/a', 'refs/heads/main')).toBe(false);
    // Another repository's are its own.
    expect(isFavorite('/b', 'refs/heads/side')).toBe(false);
    expect(isFavorite('/b', 'refs/heads/main')).toBe(true);
    // Kept, as IntelliJ keeps them: the predefined ones unmarked, the others marked.
    expect(readFavorites()['/a']).toEqual({
      favorites: ['refs/heads/side'],
      excluded: ['refs/heads/main'],
    });
    setFavorite('/a', 'refs/heads/main', true);
    setFavorite('/a', 'refs/heads/side', false);
    expect(readFavorites()['/a']).toEqual({ favorites: [], excluded: [] });
    expect(isFavorite('/a', 'refs/heads/main')).toBe(true);
  });

  it('read none from what can’t be read, and apply for the run when they can’t be kept', () => {
    localStorage.setItem('cerebro.branchFavorites', '{"/a":{"favorites":["x",1]},"/b":null}');
    expect(readFavorites()).toEqual({
      '/a': { favorites: ['x'], excluded: [] },
      '/b': { favorites: [], excluded: [] },
    });
    localStorage.setItem('cerebro.branchFavorites', 'not JSON');
    expect(readFavorites()).toEqual({});
    localStorage.removeItem('cerebro.branchFavorites');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    setFavorite('/c', 'refs/heads/x', true);
    expect(isFavorite('/c', 'refs/heads/x')).toBe(true);
  });
});

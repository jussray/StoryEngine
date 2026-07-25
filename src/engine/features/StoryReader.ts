/**
 * Story Engine - HTML5 & Modern Web Features
 * Enhanced with Web APIs, semantic markup, and performance optimizations
 */

import type { Story } from './Story'

/**
 * Story Reader - HTML5 Features
 * Implements reading experience with modern web APIs
 */
export interface StoryReaderConfig {
  fontSize?: number
  lineHeight?: number
  theme?: 'light' | 'dark' | 'auto'
  readingTime?: boolean
}

export class StoryReader {
  private config: Required<StoryReaderConfig>
  private readingPosition: number = 0
  private pageSize: number = 2000 // chars per page

  constructor(config: StoryReaderConfig = {}) {
    this.config = {
      fontSize: config.fontSize ?? 16,
      lineHeight: config.lineHeight ?? 1.5,
      theme: config.theme ?? 'auto',
      readingTime: config.readingTime ?? true,
    }
  }

  /**
   * Generate semantic HTML5 for story content
   * Uses proper heading hierarchy, semantic elements
   */
  generateHTML(story: Story): string {
    return `
      <article class="story-article" data-story-id="${story.id}">
        <header>
          <h1 class="story-title">${this.escapeHTML(story.title)}</h1>
          <div class="story-meta">
            <span class="story-author" data-author="${story.author}">
              By ${this.escapeHTML(story.author)}
            </span>
            <time class="story-date" datetime="${story.createdAt.toISOString()}">
              ${this.formatDate(story.createdAt)}
            </time>
            ${this.config.readingTime ? `<span class="story-reading-time">${this.estimateReadTime(story.content)} min read</span>` : ''}
          </div>
          ${story.tags.length > 0 ? `
            <nav class="story-tags" aria-label="Story tags">
              ${story.tags.map((tag) => `<a href="/tags/${tag}" class="tag">${this.escapeHTML(tag)}</a>`).join('')}
            </nav>
          ` : ''}
        </header>

        <main class="story-content">
          ${this.parseContent(story.content)}
        </main>

        <footer class="story-footer">
          <button class="btn-bookmark" data-story-id="${story.id}" aria-label="Bookmark story">
            🔖 Bookmark
          </button>
          <button class="btn-share" data-story-id="${story.id}" aria-label="Share story">
            🔗 Share
          </button>
        </footer>
      </article>
    `
  }

  /**
   * Parse content into semantic HTML
   * Supports paragraphs, emphasis, links
   */
  private parseContent(content: string): string {
    return content
      .split('\n\n')
      .map((paragraph) => {
        // Handle emphasis markers
        let parsed = paragraph
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // **bold**
          .replace(/\*(.*?)\*/g, '<em>$1</em>') // *italic*
          .replace(/`(.*?)`/g, '<code>$1</code>') // `code`

        // Handle links
        parsed = parsed.replace(
          /\[(.*?)\]\((https?:\/\/.*?)\)/g,
          '<a href="$2" rel="noopener noreferrer">$1</a>'
        )

        return `<p>${parsed}</p>`
      })
      .join('')
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHTML(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, (char) => map[char])
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date)
  }

  /**
   * Estimate reading time
   */
  private estimateReadTime(content: string): number {
    const wordCount = content.split(/\s+/).length
    const wordsPerMinute = 200
    return Math.ceil(wordCount / wordsPerMinute)
  }
}

/**
 * Story Storage - IndexedDB for offline support
 * Store reading progress, bookmarks, drafts
 */
export class StoryStorage {
  private dbName = 'story-engine'
  private version = 1
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Store for reading progress
        if (!db.objectStoreNames.contains('reading-progress')) {
          const progressStore = db.createObjectStore('reading-progress', { keyPath: 'storyId' })
          progressStore.createIndex('updatedAt', 'updatedAt', { unique: false })
        }

        // Store for bookmarks
        if (!db.objectStoreNames.contains('bookmarks')) {
          const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'storyId' })
          bookmarkStore.createIndex('bookmarkedAt', 'bookmarkedAt', { unique: false })
        }

        // Store for drafts
        if (!db.objectStoreNames.contains('drafts')) {
          const draftStore = db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true })
          draftStore.createIndex('updatedAt', 'updatedAt', { unique: false })
        }
      }
    })
  }

  async saveReadingProgress(storyId: string, position: number, lastReadAt: Date): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['reading-progress'], 'readwrite')
      const store = transaction.objectStore('reading-progress')
      const request = store.put({ storyId, position, updatedAt: lastReadAt })

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getReadingProgress(storyId: string): Promise<{ position: number; lastReadAt: Date } | null> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['reading-progress'], 'readonly')
      const store = transaction.objectStore('reading-progress')
      const request = store.get(storyId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result
        resolve(
          result
            ? { position: result.position, lastReadAt: new Date(result.updatedAt) }
            : null
        )
      }
    })
  }

  async bookmarkStory(storyId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['bookmarks'], 'readwrite')
      const store = transaction.objectStore('bookmarks')
      const request = store.put({ storyId, bookmarkedAt: new Date() })

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async isBookmarked(storyId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['bookmarks'], 'readonly')
      const store = transaction.objectStore('bookmarks')
      const request = store.get(storyId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(!!request.result)
    })
  }
}

/**
 * Web Share API - Native sharing
 */
export async function shareStory(story: Story): Promise<void> {
  if (!navigator.share) {
    // Fallback: copy link to clipboard
    const url = `${window.location.origin}/stories/${story.id}`
    await navigator.clipboard.writeText(url)
    alert('Story link copied!')
    return
  }

  try {
    await navigator.share({
      title: story.title,
      text: `Read "${story.title}" by ${story.author}`,
      url: `${window.location.origin}/stories/${story.id}`,
    })
  } catch (error) {
    console.error('Share failed:', error)
  }
}

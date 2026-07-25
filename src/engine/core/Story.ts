/**
 * Story Engine - SOLID Architecture Refactor
 * Separates concerns into focused, testable interfaces
 */

/**
 * Story Interface - Single Responsibility
 * Only handles story data structure
 */
export interface Story {
  id: string
  title: string
  content: string
  author: string
  createdAt: Date
  updatedAt: Date
  tags: string[]
  metadata?: Record<string, unknown>
}

export interface CreateStoryPayload {
  title: string
  content: string
  author: string
  tags?: string[]
}

/**
 * Story Repository - Data Access Layer
 * All story persistence goes through this interface
 * Can swap implementations: Memory -> Firebase -> PostgreSQL
 */
export interface StoryRepository {
  create(payload: CreateStoryPayload): Promise<Story>
  getById(id: string): Promise<Story | null>
  list(filters?: StoryFilters): Promise<Story[]>
  update(id: string, payload: Partial<Story>): Promise<Story>
  delete(id: string): Promise<void>
  search(query: string): Promise<Story[]>
}

export interface StoryFilters {
  author?: string
  tags?: string[]
  limit?: number
  offset?: number
}

/**
 * Story Service - Business Logic
 * Handles story operations, validation, workflows
 * Depends on StoryRepository interface, not concrete implementation
 */
export class StoryService {
  constructor(private repository: StoryRepository) {}

  async createStory(payload: CreateStoryPayload): Promise<Story> {
    // Validate input
    if (!payload.title?.trim()) {
      throw new Error('Title is required')
    }
    if (!payload.content?.trim()) {
      throw new Error('Content is required')
    }

    // Create through repository
    return this.repository.create(payload)
  }

  async getStory(id: string): Promise<Story> {
    const story = await this.repository.getById(id)
    if (!story) {
      throw new Error(`Story ${id} not found`)
    }
    return story
  }

  async listStories(author?: string, tags?: string[]): Promise<Story[]> {
    return this.repository.list({ author, tags })
  }

  async searchStories(query: string): Promise<Story[]> {
    if (!query?.trim()) {
      return []
    }
    return this.repository.search(query)
  }

  async updateStory(id: string, payload: Partial<Story>): Promise<Story> {
    const story = await this.getStory(id)
    return this.repository.update(id, payload)
  }

  async deleteStory(id: string): Promise<void> {
    await this.getStory(id) // Verify exists first
    return this.repository.delete(id)
  }
}

/**
 * Story Formatter - Transform Data
 * Handles presentation logic, isolated from business logic
 */
export interface StoryFormatter {
  format(story: Story): FormattedStory
  formatList(stories: Story[]): FormattedStory[]
}

export interface FormattedStory {
  id: string
  title: string
  preview: string // First 200 chars
  author: string
  createdAt: string // ISO date
  wordCount: number
  readTime: number // minutes
  tags: string[]
}

export class DefaultStoryFormatter implements StoryFormatter {
  format(story: Story): FormattedStory {
    return {
      id: story.id,
      title: story.title,
      preview: story.content.substring(0, 200).concat('...'),
      author: story.author,
      createdAt: story.createdAt.toISOString(),
      wordCount: this.countWords(story.content),
      readTime: this.estimateReadTime(story.content),
      tags: story.tags,
    }
  }

  formatList(stories: Story[]): FormattedStory[] {
    return stories.map((story) => this.format(story))
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter((word) => word.length > 0).length
  }

  private estimateReadTime(text: string): number {
    const wordCount = this.countWords(text)
    const wordsPerMinute = 200
    return Math.ceil(wordCount / wordsPerMinute)
  }
}

/**
 * Story Filter - Query Building
 * Encapsulates filtering logic
 */
export interface StoryFilter {
  byAuthor(author: string): StoryFilter
  byTags(tags: string[]): StoryFilter
  limit(n: number): StoryFilter
  offset(n: number): StoryFilter
  build(): StoryFilters
}

export class StoryFilterBuilder implements StoryFilter {
  private filters: StoryFilters = {}

  byAuthor(author: string): StoryFilter {
    this.filters.author = author
    return this
  }

  byTags(tags: string[]): StoryFilter {
    this.filters.tags = tags
    return this
  }

  limit(n: number): StoryFilter {
    this.filters.limit = n
    return this
  }

  offset(n: number): StoryFilter {
    this.filters.offset = n
    return this
  }

  build(): StoryFilters {
    return this.filters
  }
}

/**
 * Export for easy composition
 */
export {
  createMemoryStoryRepository,
  type MemoryStoryRepository,
} from './repositories/MemoryStoryRepository'
export {
  createFirebaseStoryRepository,
  type FirebaseStoryRepository,
} from './repositories/FirebaseStoryRepository'

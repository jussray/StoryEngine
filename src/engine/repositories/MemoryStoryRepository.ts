/**
 * In-Memory Story Repository
 * Useful for development and testing
 * Implements StoryRepository interface
 */

import type { Story, CreateStoryPayload, StoryRepository, StoryFilters } from './Story'

export type MemoryStoryRepository = ReturnType<typeof createMemoryStoryRepository>

export function createMemoryStoryRepository(): StoryRepository {
  const stories = new Map<string, Story>()
  let nextId = 1

  return {
    async create(payload: CreateStoryPayload): Promise<Story> {
      const story: Story = {
        id: `story-${nextId++}`,
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: payload.tags || [],
      }
      stories.set(story.id, story)
      return story
    },

    async getById(id: string): Promise<Story | null> {
      return stories.get(id) || null
    },

    async list(filters?: StoryFilters): Promise<Story[]> {
      let results = Array.from(stories.values())

      // Filter by author
      if (filters?.author) {
        results = results.filter((s) => s.author === filters.author)
      }

      // Filter by tags
      if (filters?.tags && filters.tags.length > 0) {
        results = results.filter((s) =>
          filters.tags!.some((tag) => s.tags.includes(tag))
        )
      }

      // Apply offset and limit
      const offset = filters?.offset || 0
      const limit = filters?.limit || 10
      return results.slice(offset, offset + limit)
    },

    async update(id: string, payload: Partial<Story>): Promise<Story> {
      const story = stories.get(id)
      if (!story) throw new Error(`Story ${id} not found`)

      const updated: Story = {
        ...story,
        ...payload,
        id: story.id, // Never change ID
        createdAt: story.createdAt, // Never change created date
        updatedAt: new Date(),
      }
      stories.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      stories.delete(id)
    },

    async search(query: string): Promise<Story[]> {
      const lowerQuery = query.toLowerCase()
      return Array.from(stories.values()).filter(
        (s) =>
          s.title.toLowerCase().includes(lowerQuery) ||
          s.content.toLowerCase().includes(lowerQuery) ||
          s.author.toLowerCase().includes(lowerQuery)
      )
    },
  }
}

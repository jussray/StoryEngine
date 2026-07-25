# Story Engine - SOLID & HTML5/CSS3 Modernization

## Architecture

The Story Engine now follows SOLID principles with clean separation of concerns:

### 1. Single Responsibility Principle (SRP)

Each module has one reason to change:

```typescript
// Story.ts - Data structures only
export interface Story { ... }
export interface StoryRepository { ... }

// StoryService.ts - Business logic only
export class StoryService {
  constructor(private repository: StoryRepository) {}
  async createStory(payload) { ... }
}

// StoryReader.ts - Presentation logic only
export class StoryReader {
  generateHTML(story) { ... }
}
```

### 2. Open/Closed Principle (OCP)

Open for extension, closed for modification:

```typescript
// Add new repository without changing service
class FirebaseStoryRepository implements StoryRepository { ... }
class GraphQLStoryRepository implements StoryRepository { ... }

// Service works with any repository
const service = new StoryService(firebaseRepo) // Works!
const service = new StoryService(graphqlRepo)  // Works!
```

### 3. Liskov Substitution Principle (LSP)

Any repository can replace another:

```typescript
const repos = [
  createMemoryStoryRepository(),
  createFirebaseStoryRepository(),
  createPostgresStoryRepository(),
]

// All work identically
for (const repo of repos) {
  const service = new StoryService(repo)
  await service.createStory(payload) // Same interface
}
```

### 4. Interface Segregation Principle (ISP)

Clients depend only on what they use:

```typescript
// StoryService only needs StoryRepository
// Doesn't need UserRepository, CommentRepository, etc.
class StoryService {
  constructor(private repository: StoryRepository) {}
}

// StoryReader only needs formatted data
// Doesn't need database access
class StoryReader {
  generateHTML(story: Story): string { ... }
}
```

### 5. Dependency Inversion Principle (DIP)

Depend on abstractions, not concrete implementations:

```typescript
// ✗ BAD - Depends on Firebase directly
class StoryService {
  private firebaseRepository = new FirebaseStoryRepository()
}

// ✓ GOOD - Depends on interface
class StoryService {
  constructor(private repository: StoryRepository) {}
}

// Easy to test
const mockRepo = createMemoryStoryRepository()
const service = new StoryService(mockRepo)
```

## HTML5 Features

### 1. Semantic HTML

```html
<article class="story-article" data-story-id="story-1">
  <header>
    <h1 class="story-title">Story Title</h1>
    <time datetime="2024-01-01T12:00:00Z">January 1, 2024</time>
  </header>
  
  <main class="story-content">
    <p>Story content...</p>
  </main>
  
  <footer class="story-footer">
    <button>Bookmark</button>
  </footer>
</article>
```

### 2. IndexedDB for Offline Support

```typescript
const storage = new StoryStorage()
await storage.init()

// Save reading progress
await storage.saveReadingProgress('story-1', 2500, new Date())

// Retrieve later
const progress = await storage.getReadingProgress('story-1')

// Bookmark stories
await storage.bookmarkStory('story-1')
const isBookmarked = await storage.isBookmarked('story-1')
```

### 3. Web Share API

```typescript
import { shareStory } from './StoryReader'

// Native share on mobile
await shareStory(story)
// Falls back to clipboard on desktop
```

### 4. Intl API for Dates

```typescript
const formatted = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(date)
// "January 1, 2024"
```

### 5. Data Attributes for State

```html
<article data-story-id="story-1" data-author="Jane">
  <button data-action="bookmark" class="btn-bookmark">
    Bookmark
  </button>
</article>
```

## CSS3 Features

### 1. CSS Variables

```css
:root {
  --color-text: #333;
  --color-accent: #0066cc;
  --font-serif: 'Georgia', serif;
  --line-height-reading: 1.8;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #f0f0f0;
    --color-background: #1a1a1a;
  }
}
```

### 2. Flexbox Layout

```css
.story-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
```

### 3. Media Queries

```css
@media (max-width: 768px) {
  .story-title {
    font-size: 1.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none;
  }
}
```

### 4. Transitions & Hover States

```css
.story-tags .tag {
  transition: background 0.3s ease;
}

.story-tags .tag:hover {
  background: var(--color-accent);
  color: white;
}
```

### 5. Typography Enhancement

```css
.story-content p {
  text-align: justify;
  hyphens: auto; /* Automatic hyphenation */
}

.story-content a {
  text-decoration: underline; /* Accessible links */
}
```

## File Structure

```
src/engine/
├── core/
│   └── Story.ts                 # Interfaces & service
├── repositories/
│   ├── MemoryStoryRepository.ts  # Dev/test implementation
│   └── FirebaseStoryRepository.ts # Production implementation
├── features/
│   └── StoryReader.ts           # HTML5 reader, storage, share
├── styles/
│   └── story-reader.css         # CSS3 styling
└── __tests__/
    ├── Story.test.ts
    └── StoryReader.test.ts
```

## Usage Example

```typescript
import { createMemoryStoryRepository } from './repositories/MemoryStoryRepository'
import { StoryService } from './core/Story'
import { StoryReader, StoryStorage } from './features/StoryReader'

// Setup
const repository = createMemoryStoryRepository()
const service = new StoryService(repository)
const reader = new StoryReader()
const storage = new StoryStorage()

await storage.init()

// Create story
const story = await service.createStory({
  title: 'My Story',
  content: 'Once upon a time...',
  author: 'Jane Doe',
  tags: ['adventure', 'fiction'],
})

// Generate HTML
const html = reader.generateHTML(story)
document.getElementById('story').innerHTML = html

// Track reading progress
document.addEventListener('scroll', () => {
  const position = window.scrollY
  storage.saveReadingProgress(story.id, position, new Date())
})

// Share story
document.querySelector('.btn-share')?.addEventListener('click', async () => {
  await shareStory(story)
})
```

## Testing

Because of SOLID principles, testing is straightforward:

```typescript
import { StoryService } from './Story'
import { createMemoryStoryRepository } from './repositories/MemoryStoryRepository'

describe('StoryService', () => {
  let service: StoryService

  beforeEach(() => {
    const repo = createMemoryStoryRepository() // Mock!
    service = new StoryService(repo)
  })

  it('should create a story', async () => {
    const story = await service.createStory({
      title: 'Test',
      content: 'Content',
      author: 'Test Author',
    })

    expect(story.id).toBeDefined()
    expect(story.title).toBe('Test')
  })
})
```

## Next Steps

- [x] SOLID architecture
- [x] Story service & repository
- [x] HTML5 reader with semantic markup
- [x] IndexedDB storage
- [x] Web Share API
- [x] CSS3 modern styling
- [ ] Add rich text editor
- [ ] Add comments/discussions
- [ ] Add collaborative editing
- [ ] Add analytics tracking
- [ ] Add recommendations engine
- [ ] Add search functionality
- [ ] Add export (PDF, EPUB)

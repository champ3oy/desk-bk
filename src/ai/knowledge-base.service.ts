import { Injectable } from '@nestjs/common';
import { TrainingService } from '../training/training.service';

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly trainingService: TrainingService) {}

  /**
   * Retrieve relevant knowledge base content for a given query
   * This is a simple keyword-based retrieval. For production, use vector embeddings.
   */
  async retrieveRelevantContent(
    query: string,
    organizationId: string,
    maxResults: number = 3,
  ): Promise<string> {
    try {
      // Get all training sources for the organization
      const sources = await this.trainingService.findAll(organizationId);

      if (sources.length === 0) {
        return '';
      }

      // Simple keyword matching (in production, use vector embeddings)
      const queryLower = query.toLowerCase();
      const keywords = queryLower
        .split(/\s+/)
        .filter((word) => word.length > 3);

      // Score each source based on keyword matches
      const scoredSources = sources
        .filter((source) => source.content) // Only text-based sources
        .map((source) => {
          const contentLower = (source.content || '').toLowerCase();
          const nameLower = source.name.toLowerCase();

          // Count keyword matches
          let score = 0;
          keywords.forEach((keyword) => {
            if (contentLower.includes(keyword)) score += 2;
            if (nameLower.includes(keyword)) score += 1;
          });

          return { source, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      if (scoredSources.length === 0) {
        return '';
      }

      // Format the relevant content
      const contextParts = scoredSources.map(({ source }) => {
        const content = source.content || '';
        // Truncate long content to avoid token limits
        const truncated =
          content.length > 1000 ? content.substring(0, 1000) + '...' : content;

        return `## ${source.name}\n${truncated}`;
      });

      return contextParts.join('\n\n');
    } catch (error) {
      console.error('Failed to retrieve knowledge base content:', error);
      return '';
    }
  }
}

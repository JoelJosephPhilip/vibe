import { injectable } from 'inversify';
import { MinimaxScreeningLlm } from '#root/modules/studentQuestions/services/screening/MinimaxScreeningLlm.js';
import { groupChunksBySegment } from './LocalQuestionGenerationService.js';
import { CourseSectionPlan } from '../classes/transformers/GenAI.js';

interface TranscriptChunk {
  timestamp: [number, number | null];
  text: string;
}

const SECTION_PROMPT = (segmentText: string) => `You are naming one section of a course, based on the lesson segment below. Reply ONLY with one JSON object, no prose, no markdown fences.

Lesson segment:
"""
${segmentText}
"""

Reply with exactly this shape:
{"name": "<short section title, under 8 words>", "description": "<1-2 sentence description of what this section covers>"}`;

const MODULE_PROMPT = (sectionNames: string[]) => `You are naming a course module that contains the following sections, in order:
${sectionNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Reply ONLY with one JSON object, no prose, no markdown fences, in exactly this shape:
{"name": "<short module title, under 8 words>", "description": "<1-2 sentence description of what this module covers>"}`;

/**
 * Generates AI section/module titles+descriptions for the course-structure
 * preview (GenAIService.getCoursePlan), reusing the same MinimaxScreeningLlm
 * provider LocalQuestionGenerationService already uses for question
 * generation. One LLM call per segment (not batched) so one bad/truncated
 * segment can't take out the whole plan -- mirrors that service's
 * per-question robustness pattern.
 */
@injectable()
export class LocalCoursePlanService {
  private readonly llm = new MinimaxScreeningLlm();

  async generateSectionPlans(
    transcriptChunks: TranscriptChunk[],
    segmentEnds: number[],
  ): Promise<CourseSectionPlan[]> {
    const segments = groupChunksBySegment(transcriptChunks, segmentEnds);
    const plans: CourseSectionPlan[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      plans.push({
        segmentEnd: segmentEnds[i],
        ...(await this.generateOneSection(segment.text, i)),
      });
    }
    return plans;
  }

  private async generateOneSection(
    segmentText: string,
    index: number,
  ): Promise<{ name: string; description: string }> {
    if (!segmentText.trim()) {
      return { name: `Section ${index + 1}`, description: '' };
    }
    try {
      const verdict = await this.llm.askJson(SECTION_PROMPT(segmentText));
      const name = typeof verdict.name === 'string' ? verdict.name.trim() : '';
      const description = typeof verdict.description === 'string' ? verdict.description.trim() : '';
      if (!name) throw new Error('LLM returned an empty section name');
      return { name, description };
    } catch (err) {
      // Best-effort: one bad LLM response shouldn't abort the whole plan --
      // the user is about to review and can edit/rename in the preview.
      console.warn(
        `[LocalCoursePlanService] Failed to generate a section name for segment ${index}:`,
        err instanceof Error ? err.message : err,
      );
      return { name: `Section ${index + 1}`, description: '' };
    }
  }

  async generateModulePlan(
    sectionNames: string[],
  ): Promise<{ name: string; description: string }> {
    if (sectionNames.length === 0) {
      return { name: 'Module', description: '' };
    }
    try {
      const verdict = await this.llm.askJson(MODULE_PROMPT(sectionNames));
      const name = typeof verdict.name === 'string' ? verdict.name.trim() : '';
      const description = typeof verdict.description === 'string' ? verdict.description.trim() : '';
      if (!name) throw new Error('LLM returned an empty module name');
      return { name, description };
    } catch (err) {
      console.warn(
        '[LocalCoursePlanService] Failed to generate a module name:',
        err instanceof Error ? err.message : err,
      );
      return { name: 'Module', description: '' };
    }
  }
}

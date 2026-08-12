import {AbilityBuilder, createMongoAbility} from '@casl/ability';

export class DoubtScope {
  userId: string;
  courseId?: string;
  versionId?: string;
}

export function createDoubtAbilityBuilder() {
  return new AbilityBuilder(createMongoAbility);
}

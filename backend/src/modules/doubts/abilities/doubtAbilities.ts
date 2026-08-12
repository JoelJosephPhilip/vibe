import {AbilityBuilder, MongoAbility} from '@casl/ability';
import {
  AuthenticatedUser,
  AuthenticatedUserEnrollements,
} from '#root/shared/interfaces/models.js';
import {createDoubtAbilityBuilder} from './types.js';

export enum DoubtActions {
  Create = 'create',
  View = 'view',
  Reply = 'reply',
  Moderate = 'moderate',
  Delete = 'delete',
}

export type DoubtSubjectType = 'Doubt';

export type DoubtActionsType = `${DoubtActions}` | 'manage';

export type DoubtAbilityType = [DoubtActionsType, DoubtSubjectType];

/**
 * Doubts are always course-scoped — unlike announcements there is no "general"
 * doubt, so nothing is granted outside an enrollment.
 * - ADMIN: manage all
 * - INSTRUCTOR/MANAGER: view + reply + moderate + delete within their courses
 * - STUDENT/TA/STAFF: view + create + reply within their courses
 */
export function setupDoubtAbilities(
  builder: AbilityBuilder<any>,
  user: AuthenticatedUser,
) {
  const {can} = builder;

  if (user.globalRole === 'admin') {
    can('manage', 'Doubt');
    return;
  }

  user.enrollments.forEach((enrollment: AuthenticatedUserEnrollements) => {
    const courseBounded = {
      courseId: enrollment.courseId,
      versionId: enrollment.versionId,
    };

    switch (enrollment.role) {
      case 'INSTRUCTOR':
      case 'MANAGER':
        can(DoubtActions.View, 'Doubt', courseBounded);
        can(DoubtActions.Reply, 'Doubt', courseBounded);
        can(DoubtActions.Moderate, 'Doubt', courseBounded);
        can(DoubtActions.Delete, 'Doubt', courseBounded);
        break;
      default:
        // STUDENT, TA, STAFF
        can(DoubtActions.View, 'Doubt', courseBounded);
        can(DoubtActions.Create, 'Doubt', courseBounded);
        can(DoubtActions.Reply, 'Doubt', courseBounded);
        break;
    }
  });
}

export function getDoubtAbility(user: AuthenticatedUser): MongoAbility<any> {
  const builder = createDoubtAbilityBuilder();
  setupDoubtAbilities(builder, user);
  return builder.build();
}

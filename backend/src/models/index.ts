/**
 * @file index.ts
 * @description Central export and association setup for all Sequelize models in the CloudTeams backend.
 * @author CloudTeams
 */

// TODO: Import individual models, initialize associations, and export them from this file.

export {};
// ============================================================
// PURPOSE: Single import point for all models
// WHY: Instead of 8 separate imports in every file that needs
//   models, you write one line: import { User, Team } from '../models'
// ============================================================

export { default as User } from './User';
export { default as Team } from './Team';
export { default as TeamMember } from './TeamMember';
export { default as Folder } from './Folder';
export { default as File } from './File';
export { default as Comment } from './Comment';
export { default as ActivityLog } from './ActivityLog';
export { default as SharedLink } from './SharedLink';


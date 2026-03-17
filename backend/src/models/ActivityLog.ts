/**
 * @file ActivityLog.ts
 * @description Sequelize model definition for the activity_logs table, capturing a full audit trail for CloudTeams activity feeds and AI digests.
 * @author CloudTeams
 */

// TODO: Define the ActivityLog model, its attributes, and associations used for analytics and notifications.

export {};
// ============================================================
// src/models/ActivityLog.ts
// ============================================================
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ActivityLogAttributes {
  id: number;
  team_id: number;
  user_id: number;
  action: string;        // e.g. 'file_uploaded', 'file_deleted'
  target_type?: string | null; // e.g. 'file', 'folder', 'comment'
  target_id?: number | null;
  metadata?: object | null;    // JSON — extra context
  created_at?: Date;
}
interface ActivityLogCreationAttributes 
  extends Optional<ActivityLogAttributes, 'id' | 'created_at' | 'target_type' | 'target_id' | 'metadata'> {}

class ActivityLog extends Model<ActivityLogAttributes, ActivityLogCreationAttributes>
  implements ActivityLogAttributes {
  declare id: number;
  declare team_id: number;
  declare user_id: number;
  declare action: string;
  declare target_type: string | null;
  declare target_id: number | null;
  declare metadata: object | null;
  declare created_at: Date;
}

ActivityLog.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  team_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'teams', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  action: { type: DataTypes.STRING(50), allowNull: false },
  target_type: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
  target_id: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
    // WHY JSON?: Activity metadata varies wildly. An upload event
    // has fileSize, a comment event has commentContent. Rather than
    // 20 nullable columns, one JSON column holds any shape of data.
  },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'activity_logs', timestamps: false });

export default ActivityLog;

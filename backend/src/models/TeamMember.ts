/**
 * @file TeamMember.ts
 * @description Sequelize model definition for the team_members table, linking users to teams with specific roles.
 * @author CloudTeams
 */

// TODO: Define the TeamMember model, its attributes, and associations for role-based membership.

export {};
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

// WHY a junction table?: A user can belong to many teams.
// A team can have many users. This is a "many-to-many" relationship.
// The TeamMember table is the bridge that stores BOTH IDs + the role.

interface TeamMemberAttributes {
  id: number;
  team_id: number;
  user_id: number;
  role: 'viewer' | 'editor' | 'admin';  // TypeScript enforces valid roles
  joined_at?: Date;
}

interface TeamMemberCreationAttributes 
  extends Optional<TeamMemberAttributes, 'id' | 'joined_at' | 'role'> {}

class TeamMember extends Model<TeamMemberAttributes, TeamMemberCreationAttributes>
  implements TeamMemberAttributes {
  declare id: number;
  declare team_id: number;
  declare user_id: number;
  declare role: 'viewer' | 'editor' | 'admin';
  declare joined_at: Date;
}

TeamMember.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    team_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'teams', key: 'id' },
    },
    user_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    role: {
      type: DataTypes.ENUM('viewer', 'editor', 'admin'),
      // WHY ENUM?: Only these 3 values are ever valid. If someone
      // tries to INSERT role='superadmin', PostgreSQL blocks it.
      // Better to enforce at the DB level than rely only on code.
      defaultValue: 'editor',
      allowNull: false,
    },
    joined_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'team_members', timestamps: false }
);

export default TeamMember;

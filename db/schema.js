import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', { id: text('id').primaryKey(), data: text('data').notNull() });
export const markers = sqliteTable('markers', { id: text('id').primaryKey() });
export const members = sqliteTable('members', { slot: text('slot').primaryKey(), userId: text('user_id').notNull() }, t => [uniqueIndex('members_user_id').on(t.userId)]);
export const sessions = sqliteTable('sessions', { token: text('token').primaryKey(), slot: text('slot').notNull(), expires: integer('expires').notNull() });
export const authRateLimits = sqliteTable('auth_rate_limits', { key: text('key').primaryKey(), window: integer('window').notNull(), attempts: integer('attempts').notNull() });
export const meetings = sqliteTable('meetings', { id: text('id').primaryKey(), start: text('start').notNull(), end: text('end').notNull(), title: text('title').notNull(), place: text('place').notNull().default(''), story: text('story').notNull().default('') });
export const entries = sqliteTable('entries', { id: text('id').primaryKey(), kind: text('kind').notNull(), author: text('author').notNull(), text: text('text').notNull(), mood: text('mood').notNull().default(''), date: text('date').notNull(), meetingId: text('meeting_id'), status: text('status').notNull(), created: text('created').notNull(), updated: text('updated').notNull(), readAt: text('read_at') }, t => [index('entries_kind_created').on(t.kind,t.created)]);
export const media = sqliteTable('media', { id: text('id').primaryKey(), owner: text('owner').notNull(), entryId: text('entry_id'), key: text('key').notNull(), type: text('type').notNull(), name: text('name').notNull(), deletedAt: text('deleted_at'), purgeStartedAt: text('purge_started_at') }, t => [index('media_entry_id').on(t.entryId)]);
export const comments = sqliteTable('comments', { id: text('id').primaryKey(), entryId: text('entry_id').notNull(), author: text('author').notNull(), text: text('text').notNull(), created: text('created').notNull() }, t => [index('comments_entry_id').on(t.entryId)]);
export const hearts = sqliteTable('hearts', { id: text('id').primaryKey(), entryId: text('entry_id').notNull(), author: text('author').notNull() }, t => [uniqueIndex('hearts_entry_author').on(t.entryId,t.author)]);
export const misses = sqliteTable('misses', { id: text('id').primaryKey(), author: text('author').notNull(), created: text('created').notNull() });

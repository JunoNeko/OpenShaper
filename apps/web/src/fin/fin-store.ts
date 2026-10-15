// SPDX-License-Identifier: GPL-3.0-or-later
import { createFinStore } from '@openshaper/store';

/** The fin designer's document store (one per session, like `boardStore`). */
export const finStore = createFinStore();

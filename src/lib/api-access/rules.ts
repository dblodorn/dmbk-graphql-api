import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

/*
 * Validation rules for playground (keyless) requests only. They are added per
 * request in `plugin.ts`. Yoga caches validation results keyed by the rule
 * names, so each rule keeps a stable, distinct function name and playground
 * results never mix with keyed ones.
 */

/** Only `query` operations; refused before anything runs. */
export function playgroundQueriesOnly(context: ValidationContext): ASTVisitor {
  return {
    OperationDefinition(node) {
      if (node.operation !== 'query') {
        context.reportError(
          new GraphQLError(`A ${node.operation} needs an API key.`, { nodes: [node], extensions: { code: 'FORBIDDEN' } }),
        );
      }
    },
  };
}

/** Depth of a selection set, following fragments. Introspection fields don't count. */
function depthOf(
  selectionSet: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
  visited: Set<string>,
): number {
  let max = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith('__')) continue;
      const below = selection.selectionSet ? depthOf(selection.selectionSet, fragments, visited) : 0;
      max = Math.max(max, 1 + below);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(selection.selectionSet, fragments, visited));
    } else {
      const name = selection.name.value;
      const fragment = fragments[name];
      // A cycle is reported by the standard NoFragmentCycles rule.
      if (!fragment || visited.has(name)) continue;
      visited.add(name);
      max = Math.max(max, depthOf(fragment.selectionSet, fragments, visited));
      visited.delete(name);
    }
  }
  return max;
}

/** Root fields of a selection set, aliases counted separately, through fragments. */
function rootFieldCount(
  selectionSet: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
  visited: Set<string>,
): number {
  let count = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (!selection.name.value.startsWith('__')) count += 1;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      count += rootFieldCount(selection.selectionSet, fragments, visited);
    } else {
      const name = selection.name.value;
      const fragment = fragments[name];
      if (!fragment || visited.has(name)) continue;
      visited.add(name);
      count += rootFieldCount(fragment.selectionSet, fragments, visited);
      visited.delete(name);
    }
  }
  return count;
}

function fragmentsOf(context: ValidationContext): Record<string, FragmentDefinitionNode> {
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of context.getDocument().definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments[definition.name.value] = definition;
  }
  return fragments;
}

export function createPlaygroundLimitRules({ maxDepth, maxRootFields }: { maxDepth: number; maxRootFields: number }) {
  function playgroundMaxDepth(context: ValidationContext): ASTVisitor {
    return {
      OperationDefinition(node) {
        const depth = depthOf(node.selectionSet, fragmentsOf(context), new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query depth ${depth} exceeds ${maxDepth} without an API key.`, {
              nodes: [node],
              extensions: { code: 'BAD_USER_INPUT' },
            }),
          );
        }
      },
    };
  }

  function playgroundMaxRootFields(context: ValidationContext): ASTVisitor {
    return {
      OperationDefinition(node) {
        const count = rootFieldCount(node.selectionSet, fragmentsOf(context), new Set());
        if (count > maxRootFields) {
          context.reportError(
            new GraphQLError(`${count} root fields exceed ${maxRootFields} without an API key.`, {
              nodes: [node],
              extensions: { code: 'BAD_USER_INPUT' },
            }),
          );
        }
      },
    };
  }

  return [playgroundQueriesOnly, playgroundMaxDepth, playgroundMaxRootFields];
}

// doc/plan.md mục 8 (Resource Dependency Graph). Node = Resource, cạnh = dependencies/dependents.

import { Resource } from "../types";

export class DependencyGraph {
  private nodes = new Map<string, Resource>();

  addNode(resource: Resource): void {
    this.nodes.set(resource.id, resource);
  }

  getNode(id: string): Resource | undefined {
    return this.nodes.get(id);
  }

  findByUrl(url: string): Resource | undefined {
    for (const node of this.nodes.values()) {
      if (node.url === url || node.finalUrl === url) return node;
    }
    return undefined;
  }

  addDependency(fromId: string, toId: string): void {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return;
    if (!from.dependencies.includes(toId)) from.dependencies.push(toId);
    if (!to.dependents.includes(fromId)) to.dependents.push(fromId);
  }

  all(): Resource[] {
    return [...this.nodes.values()];
  }

  size(): number {
    return this.nodes.size;
  }
}

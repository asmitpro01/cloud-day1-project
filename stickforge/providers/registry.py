"""Adapter discovery and construction.

Adapters are discovered by importing every module under the kind subpackages; each
module's ``Adapter`` subclass registers itself by ``adapter_name``. Adding a provider is
therefore: one adapter file + one ``providers:`` entry in config. Adapter modules must
keep heavy/optional imports inside functions so discovery stays cheap.
"""

from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass
from functools import cache

from stickforge.config import EngineConfig
from stickforge.providers.base import Adapter, Kind

_KIND_PACKAGES = ("tts", "image", "llm", "align", "video")


class RegistryError(Exception):
    pass


@cache
def discover() -> dict[str, type[Adapter]]:
    for sub in _KIND_PACKAGES:
        pkg_name = f"stickforge.providers.{sub}"
        try:
            pkg = importlib.import_module(pkg_name)
        except ModuleNotFoundError:
            continue
        for mod in pkgutil.iter_modules(pkg.__path__):
            importlib.import_module(f"{pkg_name}.{mod.name}")
    return dict(Adapter._registry)


@dataclass(frozen=True)
class ProviderStatus:
    name: str
    adapter: str
    kind: Kind
    model: str | None
    ready: bool
    reason: str


class Registry:
    """Builds adapter instances by configured provider name (lazily, cached)."""

    def __init__(self, config: EngineConfig) -> None:
        self.config = config
        self.adapters = discover()
        self._instances: dict[str, Adapter] = {}
        for name, pc in config.providers.items():
            if pc.adapter not in self.adapters:
                raise RegistryError(
                    f"provider {name!r}: unknown adapter {pc.adapter!r} "
                    f"(known: {', '.join(sorted(self.adapters))})"
                )

    def adapter_class(self, name: str) -> type[Adapter]:
        return self.adapters[self.config.providers[name].adapter]

    def status(self, name: str) -> ProviderStatus:
        pc = self.config.providers[name]
        cls = self.adapter_class(name)
        ready, reason = True, "ok"
        if not cls.dependency_available():
            ready, reason = False, f"optional dependency '{cls.optional_dependency}' not installed"
        elif cls.requires_key and not self.config.secret_for(name):
            ready, reason = False, f"env var {pc.api_key_env or '(api_key_env unset)'} not set"
        return ProviderStatus(name, pc.adapter, cls.kind, pc.model, ready, reason)

    def get(self, name: str, kind: Kind) -> Adapter:
        if name not in self.config.providers:
            raise RegistryError(f"unknown provider {name!r}")
        cls = self.adapter_class(name)
        if cls.kind != kind:
            raise RegistryError(f"provider {name!r} is a {cls.kind} adapter, not {kind}")
        st = self.status(name)
        if not st.ready:
            raise RegistryError(f"provider {name!r} not ready: {st.reason}")
        if name not in self._instances:
            self._instances[name] = cls(
                name, self.config.providers[name], self.config.secret_for(name)
            )
        return self._instances[name]

    def chain(self, names: list[str], kind: Kind) -> list[Adapter]:
        """Ready adapters of a fallback chain, in order. Unready ones are skipped."""
        out = [self.get(n, kind) for n in names if self.status(n).ready]
        if not out:
            raise RegistryError(f"no ready {kind} provider in chain {names}")
        return out

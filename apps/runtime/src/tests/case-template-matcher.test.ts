import { describe, expect, it } from "vitest";
import type { CaseTemplateRow } from "../utils/mappers.js";
import { findBestCaseTemplateMatch } from "../orchestrator/case-template-matcher.js";

const buildTemplateRow = (patch?: Partial<CaseTemplateRow>): CaseTemplateRow => ({
  id: "case-1",
  projectId: "project-1",
  runId: "run-1",
  type: "ui",
  title: "洛克王国搜索后登录",
  goal: "搜索洛克王国后进入官网并登录",
  entryUrl: "https://rocom.qq.com/",
  status: "active",
  summary: "matchable template",
  caseJson: JSON.stringify({
    steps: [
      {
        index: 1,
        action: {
          type: "click",
          target: "#login"
        },
        pageUrl: "https://rocom.qq.com/",
        pageTitle: "洛克王国官方网站",
        verification: {
          urlChanged: false,
          checks: [],
          passed: true,
          pageState: {
            surface: "generic",
            hasModal: false,
            hasIframe: false,
            frameCount: 0,
            hasLoginForm: false,
            hasProviderChooser: false,
            hasSearchResults: false,
            matchedSignals: ["hero-banner", "site-nav"]
          }
        }
      }
    ]
  }),
  createdAt: 1,
  updatedAt: 2,
  ...patch
});

describe("findBestCaseTemplateMatch", () => {
  it("matches the strongest reusable template for the current snapshot", () => {
    const match = findBestCaseTemplateMatch({
      snapshot: {
        url: "https://rocom.qq.com/",
        title: "洛克王国官方网站",
        screenshotPath: "/artifacts/runs/x.png",
        elements: [],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["site-nav", "hero-banner"]
        }
      },
      runConfig: {
        targetUrl: "https://rocom.qq.com/",
        mode: "general",
        language: "zh-CN",
        executionMode: "auto_batch",
        confirmDraft: false,
        goal: "搜索洛克王国后进入官网并登录",
        maxSteps: 12,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      templates: [
        buildTemplateRow(),
        buildTemplateRow({
          id: "case-2",
          title: "完全无关的官网模板",
          goal: "打开首页并浏览新闻",
          caseJson: JSON.stringify({
            steps: [
              {
                index: 1,
                action: {
                  type: "click",
                  target: "#news"
                },
                pageUrl: "https://rocom.qq.com/news",
                pageTitle: "新闻中心",
                verification: {
                  urlChanged: false,
                  checks: [],
                  passed: true,
                  pageState: {
                    surface: "search_results",
                    hasModal: false,
                    hasIframe: false,
                    frameCount: 0,
                    hasLoginForm: false,
                    hasProviderChooser: false,
                    hasSearchResults: true,
                    matchedSignals: ["search-results"]
                  }
                }
              }
            ]
          })
        })
      ]
    });

    expect(match?.replayCase.templateId).toBe("case-1");
    expect(match?.score).toBeGreaterThan(0.56);
  });

  it("does not match templates from a different root domain", () => {
    const match = findBestCaseTemplateMatch({
      snapshot: {
        url: "https://rocom.qq.com/",
        title: "洛克王国官方网站",
        screenshotPath: "/artifacts/runs/x.png",
        elements: [],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["site-nav"]
        }
      },
      runConfig: {
        targetUrl: "https://rocom.qq.com/",
        mode: "general",
        language: "zh-CN",
        executionMode: "auto_batch",
        confirmDraft: false,
        goal: "搜索洛克王国后进入官网并登录",
        maxSteps: 12,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      templates: [
        buildTemplateRow({
          id: "case-foreign",
          entryUrl: "https://example.com/",
          goal: "登录 example"
        })
      ]
    });

    expect(match).toBeNull();
  });

  it("skips templates that require more steps than the current run budget", () => {
    const match = findBestCaseTemplateMatch({
      snapshot: {
        url: "https://rocom.qq.com/",
        title: "洛克王国官方网站",
        screenshotPath: "/artifacts/runs/x.png",
        elements: [],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["site-nav", "hero-banner"]
        }
      },
      runConfig: {
        targetUrl: "https://rocom.qq.com/",
        mode: "general",
        language: "zh-CN",
        executionMode: "auto_batch",
        confirmDraft: false,
        goal: "搜索洛克王国后进入官网并登录",
        maxSteps: 1,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      templates: [
        buildTemplateRow({
          caseJson: JSON.stringify({
            steps: [
              {
                index: 1,
                action: {
                  type: "click",
                  target: "#login"
                }
              },
              {
                index: 2,
                action: {
                  type: "click",
                  target: "#submit"
                }
              }
            ]
          })
        })
      ]
    });

    expect(match).toBeNull();
  });

  it("does not auto-match a generic observe template when the run goal is search plus login", () => {
    const match = findBestCaseTemplateMatch({
      snapshot: {
        url: "https://www.baidu.com/",
        title: "百度一下，你就知道",
        screenshotPath: "/artifacts/runs/x.png",
        elements: [],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-host", "search-ui", "login-copy"]
        }
      },
      runConfig: {
        targetUrl: "https://baidu.com/",
        mode: "general",
        language: "zh-CN",
        executionMode: "stepwise_replan",
        confirmDraft: false,
        goal: "搜索洛克王国，进入官网，找到登录入口并验证 QQ 登录入口是否可见",
        maxSteps: 8,
        headed: false,
        manualTakeover: false,
        saveSession: true
      },
      templates: [
        buildTemplateRow({
          id: "baidu-observe",
          title: "Observe the homepage and stop after validating the hero text. · UI",
          goal: "Observe the homepage and stop after validating the hero text.",
          entryUrl: "https://baidu.com",
          caseJson: JSON.stringify({
            steps: [
              {
                index: 1,
                action: {
                  type: "wait",
                  ms: 1000,
                  note: "等待页面完全加载"
                },
                pageUrl: "https://www.baidu.com/",
                pageTitle: "百度一下，你就知道",
                verification: {
                  urlChanged: false,
                  checks: [],
                  passed: true,
                  pageState: {
                    surface: "search_results",
                    hasModal: false,
                    hasIframe: false,
                    frameCount: 0,
                    hasLoginForm: false,
                    hasProviderChooser: false,
                    hasSearchResults: true,
                    matchedSignals: ["search-host", "search-ui", "login-copy"]
                  }
                }
              }
            ]
          })
        })
      ]
    });

    expect(match).toBeNull();
  });
});

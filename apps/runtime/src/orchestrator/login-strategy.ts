import type { Action, InteractiveElement } from "@qpilot/shared";

export interface LoginScenario {
  name: string;
  username: string;
  password: string;
  expectedChecks: string[];
}

export interface LoginSelectors {
  username: string;
  password: string;
  submit: string;
}

const hasKeyword = (value: string | undefined, keywords: string[]): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
};

export const inferLoginSelectors = (elements: InteractiveElement[]): LoginSelectors => {
  const usernameInput = elements.find(
    (item) =>
      item.tag === "input" &&
      (item.type === "email" ||
        item.type === "text" ||
        hasKeyword(item.placeholder, ["user", "email", "账号", "用户名"]) ||
        hasKeyword(item.name, ["user", "email"]) ||
        hasKeyword(item.ariaLabel, ["user", "email", "账号", "用户名"]))
  );

  const passwordInput = elements.find(
    (item) =>
      item.tag === "input" &&
      (item.type === "password" ||
        hasKeyword(item.placeholder, ["password", "密码"]) ||
        hasKeyword(item.name, ["password", "pwd"]) ||
        hasKeyword(item.ariaLabel, ["password", "密码"]))
  );

  const submitButton = elements.find(
    (item) =>
      (item.tag === "button" || item.tag === "input" || item.tag === "a") &&
      (hasKeyword(item.text, ["login", "sign in", "登录", "submit"]) ||
        hasKeyword(item.type, ["submit"]) ||
        hasKeyword(item.ariaLabel, ["login", "sign in", "登录"]))
  );

  return {
    username: usernameInput?.id ? `#${usernameInput.id}` : "input[type='text'], input[type='email']",
    password: passwordInput?.id ? `#${passwordInput.id}` : "input[type='password']",
    submit: submitButton?.id ? `#${submitButton.id}` : "button[type='submit'], button"
  };
};

export const buildLoginScenarios = (
  validUsername: string,
  validPassword: string
): LoginScenario[] => [
  {
    name: "用户名密码都空",
    username: "",
    password: "",
    expectedChecks: ["required", "必填", "请输入"]
  },
  {
    name: "仅用户名空",
    username: "",
    password: validPassword,
    expectedChecks: ["required", "用户名", "账号", "请输入"]
  },
  {
    name: "仅密码空",
    username: validUsername,
    password: "",
    expectedChecks: ["required", "密码", "请输入"]
  },
  {
    name: "错误用户名/密码",
    username: `${validUsername}_wrong`,
    password: `${validPassword}_wrong`,
    expectedChecks: ["invalid", "错误", "失败"]
  },
  {
    name: "正确账号错误密码",
    username: validUsername,
    password: `${validPassword}_wrong`,
    expectedChecks: ["invalid", "密码", "错误", "失败"]
  },
  {
    name: "正确账号密码",
    username: validUsername,
    password: validPassword,
    expectedChecks: ["dashboard", "welcome", "首页", "退出"]
  }
];

export const buildLoginActions = (
  selectors: LoginSelectors,
  scenario: LoginScenario
): Action[] => [
  {
    type: "input",
    target: selectors.username,
    value: scenario.username,
    note: `${scenario.name} - 输入用户名`
  },
  {
    type: "input",
    target: selectors.password,
    value: scenario.password,
    note: `${scenario.name} - 输入密码`
  },
  {
    type: "click",
    target: selectors.submit,
    note: `${scenario.name} - 点击登录`
  },
  {
    type: "wait",
    ms: 1000,
    note: `${scenario.name} - 等待结果渲染`
  }
];

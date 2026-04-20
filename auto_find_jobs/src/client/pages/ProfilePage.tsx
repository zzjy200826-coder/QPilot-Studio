import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CandidateProfile } from "../../domain/schemas.js";
import { api } from "../lib/api";

const createEmptyEducation = () => ({
  school: "",
  degree: "",
  major: "",
  startDate: "",
  endDate: "",
  gpa: ""
});

const createEmptyExperience = () => ({
  company: "",
  title: "",
  startDate: "",
  endDate: "",
  summary: ""
});

const answerFieldEntries = [
  ["workAuthorization", "工作授权"],
  ["sponsorship", "签证赞助"],
  ["expectedSalary", "期望薪资"],
  ["startDate", "最早到岗时间"],
  ["relocation", "是否接受搬迁"],
  ["gender", "性别"],
  ["race", "种族 / 民族"],
  ["veteran", "退伍军人身份"],
  ["disability", "残障情况"]
] as const;

type BasicKey = keyof CandidateProfile["basic"];
type AnswerKey = keyof CandidateProfile["answers"];
type PreferenceKey = keyof CandidateProfile["preferences"];

const parseCsv = (value: string): string[] =>
  value
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);

const formatCsv = (value: string[] | undefined): string => (value ?? []).join(", ");

export const ProfilePage = () => {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: api.getProfile
  });
  const answersQuery = useQuery({
    queryKey: ["answers"],
    queryFn: api.listAnswers
  });

  const [draft, setDraft] = useState<CandidateProfile | null>(null);
  const [answerDraft, setAnswerDraft] = useState({
    label: "",
    questionKey: "",
    answer: "",
    synonyms: ""
  });

  useEffect(() => {
    if (profileQuery.data) {
      setDraft(profileQuery.data);
    }
  }, [profileQuery.data]);

  const saveProfileMutation = useMutation({
    mutationFn: api.saveProfile,
    onSuccess: (profile) => {
      setDraft(profile);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });

  const saveAnswerMutation = useMutation({
    mutationFn: api.saveAnswer,
    onSuccess: () => {
      setAnswerDraft({
        label: "",
        questionKey: "",
        answer: "",
        synonyms: ""
      });
      void queryClient.invalidateQueries({ queryKey: ["answers"] });
    }
  });

  const deleteAnswerMutation = useMutation({
    mutationFn: api.deleteAnswer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["answers"] });
    }
  });

  const updateBasicField = (key: BasicKey, value: string) => {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      basic: {
        ...draft.basic,
        [key]: value
      }
    });
  };

  const updateAnswerField = (key: AnswerKey, value: string) => {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      answers: {
        ...draft.answers,
        [key]: value
      }
    });
  };

  const updatePreferenceField = (key: PreferenceKey, value: string) => {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      preferences: {
        ...draft.preferences,
        [key]: parseCsv(value)
      }
    });
  };

  if (!draft) {
    return <div className="workspace-empty">正在加载候选人资料中心...</div>;
  }

  return (
    <div className="workspace-stack">
      <section className="section-headline">
        <div>
          <p className="workspace-kicker">候选人资料</p>
          <h3>维护一份已确认的个人档案，供所有申请表复用。</h3>
        </div>
        <button
          type="button"
          data-testid="save-profile-button"
          className="button button-primary"
          onClick={() => saveProfileMutation.mutate(draft)}
        >
          {saveProfileMutation.isPending ? "保存中..." : "保存资料"}
        </button>
      </section>

      <section className="form-grid">
        <label className="form-field">
          <span>名</span>
          <input
            data-testid="profile-first-name"
            value={draft.basic.firstName}
            onChange={(event) => updateBasicField("firstName", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>姓</span>
          <input
            data-testid="profile-last-name"
            value={draft.basic.lastName}
            onChange={(event) => updateBasicField("lastName", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>邮箱</span>
          <input
            data-testid="profile-email"
            value={draft.basic.email}
            onChange={(event) => updateBasicField("email", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>电话</span>
          <input
            data-testid="profile-phone"
            value={draft.basic.phone}
            onChange={(event) => updateBasicField("phone", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>城市</span>
          <input
            data-testid="profile-city"
            value={draft.basic.city}
            onChange={(event) => updateBasicField("city", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>国家 / 地区</span>
          <input
            data-testid="profile-country"
            value={draft.basic.country}
            onChange={(event) => updateBasicField("country", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>LinkedIn</span>
          <input
            data-testid="profile-linkedin"
            value={draft.basic.linkedin ?? ""}
            onChange={(event) => updateBasicField("linkedin", event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>GitHub</span>
          <input
            value={draft.basic.github ?? ""}
            onChange={(event) => updateBasicField("github", event.target.value)}
          />
        </label>
        <label className="form-field form-field-wide">
          <span>作品集 / 个人网站</span>
          <input
            value={draft.basic.portfolio ?? ""}
            onChange={(event) => updateBasicField("portfolio", event.target.value)}
          />
        </label>
      </section>

      <section className="workspace-two-column">
        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">教育经历</p>
              <h4>结构化录入，方便稳定映射到申请表字段。</h4>
            </div>
            <button
              type="button"
              className="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  education: [...draft.education, createEmptyEducation()]
                })
              }
            >
              添加教育经历
            </button>
          </div>
          <div className="workspace-stack">
            {draft.education.map((item, index) => (
              <div key={`education-${index}`} className="row-editor">
                <div className="row-editor-grid">
                  <input
                    placeholder="学校"
                    value={item.school}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        education: draft.education.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, school: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="学位"
                    value={item.degree}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        education: draft.education.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, degree: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="专业"
                    value={item.major ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        education: draft.education.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, major: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="开始时间"
                    value={item.startDate ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        education: draft.education.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, startDate: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="结束时间"
                    value={item.endDate ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        education: draft.education.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, endDate: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="GPA"
                    value={item.gpa ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        education: draft.education.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, gpa: event.target.value } : entry
                        )
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      education: draft.education.filter((_, entryIndex) => entryIndex !== index)
                    })
                  }
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">工作 / 实习经历</p>
              <h4>优先填写最近经历和可直接复用的职责总结。</h4>
            </div>
            <button
              type="button"
              className="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  experience: [...draft.experience, createEmptyExperience()]
                })
              }
            >
              添加经历
            </button>
          </div>
          <div className="workspace-stack">
            {draft.experience.map((item, index) => (
              <div key={`experience-${index}`} className="row-editor">
                <div className="row-editor-grid">
                  <input
                    placeholder="公司"
                    value={item.company}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        experience: draft.experience.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, company: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="职位名称"
                    value={item.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        experience: draft.experience.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, title: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="开始时间"
                    value={item.startDate ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        experience: draft.experience.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, startDate: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <input
                    placeholder="结束时间"
                    value={item.endDate ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        experience: draft.experience.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, endDate: event.target.value } : entry
                        )
                      })
                    }
                  />
                  <textarea
                    className="row-editor-wide"
                    placeholder="经历总结"
                    value={item.summary}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        experience: draft.experience.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, summary: event.target.value } : entry
                        )
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      experience: draft.experience.filter((_, entryIndex) => entryIndex !== index)
                    })
                  }
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="workspace-two-column">
        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">岗位偏好</p>
              <h4>用于入口页自动选岗，尤其适合 Moka 等公司职位门户。</h4>
            </div>
          </div>
          <div className="workspace-stack">
            <label className="form-field">
              <span>目标岗位关键词</span>
              <input
                placeholder="例如：前端, 后端, 算法, AI, 产品"
                value={formatCsv(draft.preferences.targetKeywords)}
                onChange={(event) => updatePreferenceField("targetKeywords", event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>期望地点</span>
              <input
                placeholder="例如：上海, 北京, 深圳, Remote"
                value={formatCsv(draft.preferences.preferredLocations)}
                onChange={(event) => updatePreferenceField("preferredLocations", event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>排除关键词</span>
              <input
                placeholder="例如：销售, 运营, 线下"
                value={formatCsv(draft.preferences.excludeKeywords)}
                onChange={(event) => updatePreferenceField("excludeKeywords", event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">附件文件</p>
              <h4>系统只保存本地路径，并在上传时复用。</h4>
            </div>
          </div>
          <div className="workspace-stack">
            <label className="form-field">
              <span>简历路径</span>
              <input
                data-testid="profile-resume-path"
                value={draft.files.resumePath}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    files: {
                      ...draft.files,
                      resumePath: event.target.value
                    }
                  })
                }
              />
            </label>
            <label className="form-field">
              <span>求职信路径</span>
              <input
                value={draft.files.coverLetterPath ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    files: {
                      ...draft.files,
                      coverLetterPath: event.target.value
                    }
                  })
                }
              />
            </label>
            <label className="form-field">
              <span>成绩单路径</span>
              <input
                value={draft.files.transcriptPath ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    files: {
                      ...draft.files,
                      transcriptPath: event.target.value
                    }
                  })
                }
              />
            </label>
          </div>
        </div>
      </section>

      <section className="workspace-two-column">
        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">高风险问题默认答案</p>
              <h4>只有你明确填写过的内容才会复用；缺失内容始终进入人工确认。</h4>
            </div>
          </div>
          <div className="form-grid">
            {answerFieldEntries.map(([key, label]) => (
              <label key={key} className="form-field">
                <span>{label}</span>
                <input
                  value={draft.answers[key] ?? ""}
                  onChange={(event) => updateAnswerField(key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">答案库</p>
              <h4>为常见申请问题保存标准答案和语义别名。</h4>
            </div>
          </div>

          <div className="workspace-two-column">
            <div className="workspace-stack">
              <label className="form-field">
                <span>名称</span>
                <input
                  value={answerDraft.label}
                  onChange={(event) =>
                    setAnswerDraft({
                      ...answerDraft,
                      label: event.target.value
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>问题键</span>
                <input
                  value={answerDraft.questionKey}
                  onChange={(event) =>
                    setAnswerDraft({
                      ...answerDraft,
                      questionKey: event.target.value
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>答案</span>
                <input
                  value={answerDraft.answer}
                  onChange={(event) =>
                    setAnswerDraft({
                      ...answerDraft,
                      answer: event.target.value
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>同义词（逗号分隔）</span>
                <input
                  value={answerDraft.synonyms}
                  onChange={(event) =>
                    setAnswerDraft({
                      ...answerDraft,
                      synonyms: event.target.value
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  saveAnswerMutation.mutate({
                    label: answerDraft.label,
                    questionKey: answerDraft.questionKey,
                    answer: answerDraft.answer,
                    synonyms: parseCsv(answerDraft.synonyms)
                  })
                }
              >
                {saveAnswerMutation.isPending ? "保存中..." : "保存答案规则"}
              </button>
            </div>

            <div className="workspace-stack">
              {answersQuery.data?.map((item) => (
                <article key={item.id} className="list-card">
                  <div>
                    <p className="list-card-title">{item.label}</p>
                    <p className="list-card-copy">{item.questionKey}</p>
                  </div>
                  <p className="list-card-copy">答案：{item.answer}</p>
                  {item.synonyms.length > 0 ? (
                    <p className="list-card-copy">别名：{item.synonyms.join(", ")}</p>
                  ) : null}
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => deleteAnswerMutation.mutate(item.id)}
                  >
                    删除
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
